/// <reference types="@cloudflare/workers-types" />

/**
 * Gateway environment. Note what is NOT here: no wallet to watch, no token mint,
 * no chain transfer to parse. The gateway only needs its own payTo identity, the
 * Avalanche verifier/pool addresses, and a nullifier store.
 */
export interface Env {
  /** KV namespace for nullifier-based replay prevention. */
  PAYMENT_KV: KVNamespace;

  // ── Avalanche / null-402 config (wrangler vars) ────────────────────────────
  /** Address this gateway is paid to — bound into every proof. */
  PAYMENT_PAYTO: string;
  /** EVM JSON-RPC endpoint (Fuji C-Chain). */
  EVM_RPC_URL: string;
  /** Chain id (Fuji = 43113). */
  EVM_CHAIN_ID: string;
  /** Deployed null-402 Pool address (0x...). */
  POOL_CONTRACT_ID: string;
  /** Deployed Groth16 verifier address (0x...). */
  VERIFIER_CONTRACT_ID: string;
  /** Comma-separated recent Pool roots the gateway accepts (it computes these
   *  off-chain from on-chain deposits). Empty = accept any non-empty (dev only). */
  KNOWN_ROOTS: string;

  // ── Dev scaffold ───────────────────────────────────────────────────────────
  /** "evm" (real on-chain ZK) | "dev" (insecure local tag). */
  VERIFY_MODE: string;
  /** Shared secret for the dev verifier — dev/test only. (wrangler secret) */
  DEV_SHARED_SECRET: string;
}
