/**
 * Private payment verification middleware — thin wrapper over the null-402 SDK.
 *
 * Flow (all in the SDK's verifyPayment):
 *   decode X-PAYMENT → check payTo / amount tier / request binding / known root
 *   → claim nullifier (replay) → verify proof → roll back on any failure.
 *
 * The gateway only chooses the verifier (real EVM vs dev scaffold) and maps
 * the outcome to an HTTP response. No wallet, amount, or endpoint is ever logged.
 */

import type { Context } from "hono";
import type { Env } from "../types.js";
import {
  build402,
  verifyPayment,
  evmVerifier,
  devVerifier,
  poolIsSpent,
  type GateConfig,
  type Verifier,
} from "null-402/server";
import { kvNullifierStore } from "../lib/kv.js";

export interface GatewayTerms {
  requiredAmount: number; // base units
  description: string;
}

export interface VerifiedPayment {
  proofRef: string;
  mode: "evm" | "local" | "dev";
}

function selectVerifier(env: Env): Verifier {
  if (env.VERIFY_MODE === "dev") {
    return devVerifier({ sharedSecret: env.DEV_SHARED_SECRET ?? "", allowInsecure: true });
  }
  return evmVerifier({
    rpcUrl: env.EVM_RPC_URL,
    verifierContractId: env.VERIFIER_CONTRACT_ID,
    chainId: env.EVM_CHAIN_ID ? Number(env.EVM_CHAIN_ID) : 43113,
  });
}

export async function privateVerify(
  c: Context<{ Bindings: Env }>,
  terms: GatewayTerms,
): Promise<VerifiedPayment | Response> {
  const path = new URL(c.req.url).pathname;
  const isDev = c.env.VERIFY_MODE === "dev";
  const hasPayment = (c.req.header("X-PAYMENT") ?? "").trim().length > 0;

  // Gateway-managed roots: the operator computes recent Pool roots off-chain from
  // on-chain deposits and lists them in KNOWN_ROOTS.
  const knownSet = new Set(
    (c.env.KNOWN_ROOTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );

  // Fail closed: in production, refuse to verify a payment when NO pool roots are
  // configured. Never fall through to accepting an arbitrary root — that would
  // let a proof against a fabricated tree pass root-binding. (The dev scaffold
  // keeps the permissive "any non-empty root" behavior for local testing.)
  if (hasPayment && knownSet.size === 0 && !isDev) {
    return c.json(
      {
        error: "roots-unconfigured",
        message:
          "KNOWN_ROOTS is empty; the gateway refuses to accept any Merkle root. " +
          "Configure KNOWN_ROOTS with the current pool root(s).",
      },
      503,
    );
  }

  const cfg: GateConfig = {
    requiredAmount: terms.requiredAmount,
    payTo: c.env.PAYMENT_PAYTO,
    description: terms.description,
    verifier: selectVerifier(c.env),
    nullifiers: kvNullifierStore(c.env.PAYMENT_KV),
    // Empty set → accept any non-empty root ONLY in dev; production requires an
    // explicit match (and is already 503'd above when a payment is present).
    isKnownRoot: async (root) =>
      knownSet.size > 0 ? knownSet.has(root) : isDev ? root.length > 0 : false,
    // Authoritative on-chain double-spend recheck (defense-in-depth) when a real
    // Pool is configured. Skipped in dev / when POOL_CONTRACT_ID is unset.
    ...(c.env.POOL_CONTRACT_ID && !isDev
      ? {
          isSpentOnChain: (nullifier: string) =>
            poolIsSpent({
              rpcUrl: c.env.EVM_RPC_URL,
              chainId: c.env.EVM_CHAIN_ID ? Number(c.env.EVM_CHAIN_ID) : 43113,
              poolContractId: c.env.POOL_CONTRACT_ID,
              nullifier,
            }),
        }
      : {}),
  };

  const outcome = await verifyPayment(
    { method: c.req.method, path, paymentHeader: c.req.header("X-PAYMENT") ?? null },
    cfg,
  );

  if (!outcome.ok) {
    if (outcome.reason === "no-payment") {
      const r = build402({
        requiredAmount: terms.requiredAmount,
        payTo: cfg.payTo,
        description: terms.description,
        resource: path,
      });
      return c.json(r.body, r.status, r.headers);
    }
    const status =
      outcome.reason === "replay" || outcome.reason === "invalid-proof" ? 402 : 400;
    return c.json({ error: "payment-rejected", reason: outcome.reason }, status);
  }

  return { proofRef: outcome.result.proofRef, mode: outcome.result.mode };
}
