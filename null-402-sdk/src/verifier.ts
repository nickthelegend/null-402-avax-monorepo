/**
 * Proof verifiers.
 *
 * A Verifier turns a ProofBundle into a boolean. Implementations:
 *
 *   evmVerifier — REAL. Calls the deployed Groth16 verifier contract on Avalanche
 *     via eth_call (view). The BN254 pairing check runs on-chain (precompiles
 *     0x06/0x07/0x08); this SDK only encodes args and reads the boolean.
 *     Read-only: no gas, no signature, no state change.
 *
 *   localGroth16Verifier — REAL off-chain Groth16 verification with snarkjs (the
 *     same pairing check, run locally). Use where there's no chain access.
 *
 *   devVerifier — TEMPORARY SCAFFOLD, dev-only (HMAC tag, not real ZK). Refuses
 *     to run unless explicitly opted in.
 */

import type { ProofBundle } from "./types.js";
import { createPublicClient, http, defineChain, type Hex } from "viem";

export interface Verifier {
  readonly mode: "evm" | "local" | "dev";
  /** Returns true iff the proof is valid for its public signals. Must NOT do
   *  policy checks (price/recipient/replay) — those live in the gate. */
  verify(bundle: ProofBundle): Promise<boolean>;
}

/** Public-signal array in the circuit's fixed order. Used by every real verifier
 *  and must match payment.circom's `main {public [...]}` list. */
export function publicSignalArray(bundle: ProofBundle): string[] {
  const s = bundle.publicSignals;
  return [s.nullifier, s.merkleRoot, s.payTo, s.requiredAmount, s.contextHash];
}

// ── REAL: on-chain Groth16 verification via Avalanche eth_call ───────────────

export interface EvmVerifierConfig {
  /** EVM JSON-RPC endpoint, e.g. https://api.avax-test.network/ext/bc/C/rpc */
  rpcUrl: string;
  /** Deployed Groth16Verifier address (0x...). */
  verifierContractId: string;
  /** Chain id (defaults to Fuji 43113). */
  chainId?: number;
}

const VERIFIER_ABI = [
  {
    type: "function",
    name: "verifyProof",
    stateMutability: "view",
    inputs: [
      { name: "a", type: "uint256[2]" },
      { name: "b", type: "uint256[2][2]" },
      { name: "c", type: "uint256[2]" },
      { name: "pubSignals", type: "uint256[5]" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * Verify the Groth16 proof by calling `verifyProof(a,b,c,pub)` on the deployed
 * verifier contract via eth_call. The BN254 pairing check runs on-chain
 * (precompiles) — trust is anchored on Avalanche; this SDK only formats the
 * snarkjs proof (with the G2 coordinate swap) and reads the boolean. Read-only:
 * no gas, no signature, no state change.
 */
export function evmVerifier(cfg: EvmVerifierConfig): Verifier {
  return {
    mode: "evm",
    async verify(bundle: ProofBundle): Promise<boolean> {
      const chain = defineChain({
        id: cfg.chainId ?? 43113,
        name: "avalanche-fuji",
        nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
      });
      const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
      const p = bundle.proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      const a = [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])] as const;
      const b = [
        [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
        [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
      ] as const;
      const c = [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])] as const;
      const pub = publicSignalArray(bundle).map((s) => BigInt(s)) as unknown as readonly [
        bigint, bigint, bigint, bigint, bigint,
      ];
      try {
        return (await client.readContract({
          address: cfg.verifierContractId as Hex,
          abi: VERIFIER_ABI,
          functionName: "verifyProof",
          args: [a, b, c, pub] as never,
        })) as boolean;
      } catch {
        return false;
      }
    },
  };
}

// ── REAL: off-chain Groth16 verification via snarkjs ─────────────────────────

/**
 * Verify the Groth16 proof off-chain with snarkjs against the circuit's verifying
 * key. This is REAL zero-knowledge verification — the same pairing check the
 * Soroban contract performs, just run locally. Use it where there is no chain
 * access (tests, edge environments) or as a fast pre-check before sorobanVerifier.
 *
 * Requires `snarkjs` (optional peer dep) and the circuit's verification_key.json.
 */
export function localGroth16Verifier(opts: { verificationKey: object }): Verifier {
  return {
    mode: "local",
    async verify(bundle: ProofBundle): Promise<boolean> {
      const snarkjs = await loadSnarkjs();
      try {
        return await snarkjs.groth16.verify(
          opts.verificationKey,
          publicSignalArray(bundle),
          bundle.proof,
        );
      } catch {
        return false;
      }
    },
  };
}

/** Dynamically load snarkjs (CJS or ESM interop) so it stays an optional dep.
 *  Indirect specifier keeps TS/bundlers from resolving it at build time. */
export async function loadSnarkjs(): Promise<any> {
  const spec = "snarkjs";
  const m: any = await import(spec);
  const snarkjs = m?.groth16 ? m : m?.default;
  if (!snarkjs?.groth16) {
    throw new Error("snarkjs is required for real Groth16 proving/verification. Install it: npm i snarkjs");
  }
  return snarkjs;
}

// ── TEMPORARY: dev scaffold (NOT real ZK) ────────────────────────────────────

/**
 * Dev-only verifier. Recomputes an HMAC-SHA256 tag over the public signals with
 * a shared secret and compares it to `bundle.proof`. Lets the gateway + client
 * agree on a valid-shaped exchange before the real circuit exists.
 *
 * Guardrails: throws unless `allowInsecure` is true. Production code paths must
 * never construct this.
 */
export function devVerifier(opts: { sharedSecret: string; allowInsecure: boolean }): Verifier {
  if (!opts.allowInsecure) {
    throw new Error(
      "devVerifier is an insecure scaffold and is disabled. Pass allowInsecure:true " +
        "ONLY in local/dev, or switch to sorobanVerifier for real ZK verification.",
    );
  }
  return {
    mode: "dev",
    async verify(bundle: ProofBundle): Promise<boolean> {
      const expected = await devTag(opts.sharedSecret, bundle.publicSignals);
      return typeof bundle.proof === "string" && timingSafeEqual(bundle.proof, expected);
    },
  };
}

/** Shared dev tag used by both devVerifier and the dev prover in client.ts. */
export async function devTag(
  secret: string,
  signals: ProofBundle["publicSignals"],
): Promise<string> {
  const enc = new TextEncoder();
  const msg = [
    signals.nullifier,
    signals.merkleRoot,
    signals.payTo,
    signals.requiredAmount,
    signals.contextHash,
  ].join("|");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
