/**
 * Run the null-402 gateway as a real local HTTP server (Node), VERIFY_MODE=evm.
 * When `operatorSecret` is provided it also **settles on-chain** when a payment
 * is accepted: pool.settle moves a fixed-denomination payout (1 nUSD) to the
 * provider and burns the nullifier on Avalanche Fuji — so the agent's payment
 * actually pays.
 *
 * Binds an OS-assigned (ephemeral) port by default. Override with NULL402_PORT.
 */
import { serve } from "@hono/node-server";
import app from "../../null-402-gateway/dist/index.js";
import {
  decodePayment, poolSettle, poolCommitments, poolRoot, poolIsSpent, poolRegisterRoot,
} from "null-402";

const VERIFIER = process.env.NULL402_VERIFIER ?? "0x0b44836dDc460f589ce4EB97f276e533A2bE6060";
const POOL = process.env.NULL402_POOL ?? "0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C";
const RPC = process.env.NULL402_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc";
const CHAIN_ID = Number(process.env.NULL402_CHAIN_ID ?? 43113);

/** Fixed note denomination = the per-payment settlement amount (1 nUSD, base units). */
export const DENOM = 10_000_000n;

/** Returns a promise of { url, port, close }. */
export function startGateway({
  port = Number(process.env.NULL402_PORT ?? 0),
  payTo,
  knownRoots = "",
  operatorSecret,
  settleAmount = DENOM,
}) {
  const store = new Map();
  const env = {
    PAYMENT_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
    },
    PAYMENT_PAYTO: payTo,
    VERIFY_MODE: "evm",
    EVM_RPC_URL: RPC,
    EVM_CHAIN_ID: String(CHAIN_ID),
    VERIFIER_CONTRACT_ID: VERIFIER,
    POOL_CONTRACT_ID: POOL,
    KNOWN_ROOTS: knownRoots,
  };

  // Wrap the gateway: validate the proof's root against the CURRENT on-chain pool
  // root → verify (app.fetch) → on success, settle on-chain.
  let rootCache = { root: "", at: 0 };
  let lastRegisteredRoot = "";
  const handler = async (req) => {
    const xpay = req.headers.get("X-PAYMENT");
    if (xpay) {
      if (Date.now() - rootCache.at > 8000) {
        try {
          const commitments = await poolCommitments({ rpcUrl: RPC, chainId: CHAIN_ID, poolContractId: POOL });
          rootCache = { root: await poolRoot(commitments), at: Date.now() };
        } catch { /* keep last known root */ }
      }
      // gateway accepts ONLY the actual current pool root (not any non-empty root)
      env.KNOWN_ROOTS = rootCache.root;
    }
    const res = await app.fetch(req, env);
    if (res.status !== 200 || !operatorSecret || !xpay) return res;

    const headers = new Headers(res.headers);
    try {
      const bundle = decodePayment(xpay);
      const nullifier = bundle.publicSignals.nullifier;

      // Defense-in-depth: never settle a nullifier already burned on-chain (the
      // Pool would revert anyway, but this avoids wasting an operator tx and marks
      // the response as a skipped settlement rather than a hard failure).
      if (await poolIsSpent({ rpcUrl: RPC, chainId: CHAIN_ID, poolContractId: POOL, nullifier })) {
        headers.set("X-Settle-Error", "nullifier already spent on-chain");
        return new Response(await res.text(), { status: 200, headers });
      }

      // The Pool only settles proofs whose merkleRoot it has registered. Register
      // the current root (operator-driven) before settling; cache to avoid a
      // redundant tx when the root hasn't changed.
      const root = bundle.publicSignals.merkleRoot;
      if (root && root !== lastRegisteredRoot) {
        await poolRegisterRoot({ rpcUrl: RPC, chainId: CHAIN_ID, poolContractId: POOL, operatorSecret, root });
        lastRegisteredRoot = root;
      }

      // Payout is BOUND to the proof (recipient = address(uint160(payTo)), amount =
      // requiredAmount); poolSettle derives both from the bundle. `payTo`/
      // `settleAmount` no longer parametrize the on-chain payout.
      const settle = await poolSettle({
        rpcUrl: RPC, chainId: CHAIN_ID, poolContractId: POOL, operatorSecret, bundle,
      });
      headers.set("X-Settle-Tx", settle.hash);
    } catch (e) {
      headers.set("X-Settle-Error", String(e?.message ?? e).slice(0, 120));
    }
    return new Response(await res.text(), { status: 200, headers });
  };

  return new Promise((resolve) => {
    const server = serve({ fetch: handler, port }, (info) => {
      resolve({ url: `http://localhost:${info.port}`, port: info.port, close: () => server.close() });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payTo = process.env.NULL402_PROVIDER;
  if (!payTo) {
    console.error("Set NULL402_PROVIDER (a funded Fuji 0x address).");
    process.exit(1);
  }
  const { url } = await startGateway({
    payTo,
    operatorSecret: process.env.NULL402_OPERATOR_SECRET,
  });
  console.log(`null-402 gateway (VERIFY_MODE=evm, settling=${!!process.env.NULL402_OPERATOR_SECRET}) on ${url}`);
}
