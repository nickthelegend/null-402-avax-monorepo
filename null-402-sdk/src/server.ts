/**
 * null-402 server SDK — the part an API provider drops in to get paid privately.
 *
 * Verifier / Policy / Application split (per Stellar zk-proofs guidance):
 *   - Verifier (verifier.ts): cryptographic validity only.
 *   - Policy (here):          recipient, amount tier, request binding, replay.
 *   - Application (your app):  runs only after verifyPayment() returns valid.
 */

import type { ProofBundle, RejectReason, VerifyResult } from "./types.js";
import type { Verifier } from "./verifier.js";
import { decodePayment, contextPreimage, hashContext, addressToField } from "./proof.js";

/** Anti-replay store keyed on NULLIFIER (never wallet, never tx). 24h TTL is
 *  enough — proofs are request-bound and short-lived. */
export interface NullifierStore {
  /** True if this nullifier was already spent. */
  has(nullifier: string): Promise<boolean>;
  /** Mark as spent. */
  add(nullifier: string): Promise<void>;
  /** Undo a mark (used when a later check fails so the client can retry). */
  remove(nullifier: string): Promise<void>;
  /** Atomic check-and-set: mark the nullifier as spent iff it wasn't already,
   *  returning `true` when it was newly claimed and `false` if it was already
   *  present. Closes the TOCTOU gap between a separate has() then add(). Optional
   *  for backwards compatibility — verifyPayment falls back to has()+add() when a
   *  store doesn't implement it. */
  addIfAbsent?(nullifier: string): Promise<boolean>;
}

export interface PaymentTerms {
  /** Price in stroops / asset base units. */
  requiredAmount: number | string;
  /** Account/contract that must be the proof's payTo (your gateway). */
  payTo: string;
  /** Human description shown in the 402 body. */
  description?: string;
}

export interface GateConfig extends PaymentTerms {
  verifier: Verifier;
  nullifiers: NullifierStore;
  /** Accepts a Merkle root iff it is a known/recent Pool root. Phase 2: query
   *  the Pool contract's root history. Default dev policy: accept any non-empty. */
  isKnownRoot?: (root: string) => Promise<boolean>;
  /** Authoritative on-chain double-spend check. When provided, the gate also
   *  confirms the nullifier isn't already burned in the Pool (via pool.isSpent),
   *  catching replays the in-memory/KV store missed (e.g. after a restart, across
   *  isolates, or a settle it never recorded). Defense-in-depth: on an RPC error
   *  the gate proceeds (the Pool's settle is the final single-use backstop). */
  isSpentOnChain?: (nullifier: string) => Promise<boolean>;
}

/** Build the x402 `402 Payment Required` body for a request. */
export function build402(opts: PaymentTerms & { resource: string }) {
  return {
    status: 402 as const,
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Required-Version": "1",
      "X-Privacy": "null-402-zk",
    },
    body: {
      version: 1,
      accepts: [
        {
          scheme: "exact" as const,
          network: "avalanche-fuji",
          maxAmountRequired: String(opts.requiredAmount),
          resource: opts.resource,
          description: opts.description ?? "null-402 private payment required",
          mimeType: "application/json",
          payTo: opts.payTo,
          maxTimeoutSeconds: 120,
          extra: { privacy: "zk-groth16", proof: "X-PAYMENT: base64url(ProofBundle)" },
        },
      ],
    },
  };
}

export type VerifyOutcome =
  | { ok: true; result: VerifyResult }
  | { ok: false; reason: RejectReason };

/**
 * Full private-payment verification for one request. Order matters: cheap public
 * checks first, the (costlier) proof verification last, replay guarded around it.
 */
export async function verifyPayment(
  req: { method: string; path: string; paymentHeader: string | null },
  cfg: GateConfig,
): Promise<VerifyOutcome> {
  const bundle = decodePayment(req.paymentHeader);
  if (!bundle) return { ok: false, reason: req.paymentHeader ? "bad-bundle" : "no-payment" };

  const s = bundle.publicSignals;

  // ── Policy: recipient binding (compare field-encoded payTo) ────────────────
  if (s.payTo !== (await addressToField(cfg.payTo))) {
    return { ok: false, reason: "wrong-recipient" };
  }

  // ── Policy: amount tier (proof asserts note_value >= requiredAmount) ────────
  if (BigInt(s.requiredAmount) < BigInt(cfg.requiredAmount)) {
    return { ok: false, reason: "insufficient-amount" };
  }

  // ── Policy: request binding ────────────────────────────────────────────────
  const expectCtx = await hashContext(
    contextPreimage({
      method: req.method,
      path: req.path,
      requiredAmount: cfg.requiredAmount,
      payTo: cfg.payTo,
    }),
  );
  if (s.contextHash !== expectCtx) return { ok: false, reason: "context-mismatch" };

  // ── Policy: Merkle root is a real Pool root ────────────────────────────────
  const knownRoot = cfg.isKnownRoot ?? (async (r: string) => r.length > 0);
  if (!(await knownRoot(s.merkleRoot))) return { ok: false, reason: "unknown-root" };

  // ── Replay: atomically claim the nullifier (closes the has()+add() TOCTOU) ──
  const claimed = cfg.nullifiers.addIfAbsent
    ? await cfg.nullifiers.addIfAbsent(s.nullifier)
    : (await cfg.nullifiers.has(s.nullifier))
      ? false
      : (await cfg.nullifiers.add(s.nullifier), true);
  if (!claimed) return { ok: false, reason: "replay" };

  // ── Replay: authoritative on-chain double-spend check ──────────────────────
  // The in-memory/KV store can miss a spend (restart, other isolate, a settle it
  // never recorded); the Pool is the source of truth. Fail open on RPC errors —
  // the Pool's settle() still rejects a truly-spent nullifier.
  if (cfg.isSpentOnChain) {
    let spentOnChain = false;
    try {
      spentOnChain = await cfg.isSpentOnChain(s.nullifier);
    } catch {
      spentOnChain = false;
    }
    if (spentOnChain) {
      await cfg.nullifiers.remove(s.nullifier);
      return { ok: false, reason: "replay" };
    }
  }

  // ── Verifier: cryptographic validity (dev tag now, on-chain Groth16 Phase 2)─
  let valid = false;
  try {
    valid = await cfg.verifier.verify(bundle);
  } catch {
    await cfg.nullifiers.remove(s.nullifier);
    return { ok: false, reason: "invalid-proof" };
  }
  if (!valid) {
    await cfg.nullifiers.remove(s.nullifier);
    return { ok: false, reason: "invalid-proof" };
  }

  return {
    ok: true,
    result: {
      valid: true,
      proofRef: `${cfg.verifier.mode}:${s.nullifier.slice(0, 16)}`,
      mode: cfg.verifier.mode,
    },
  };
}

export { decodePayment, contextPreimage, hashContext } from "./proof.js";
export * from "./verifier.js";
export * from "./types.js";
/** On-chain double-spend check for the verify gate's `isSpentOnChain` hook. */
export { poolIsSpent } from "./evm.js";

/** In-memory nullifier store — fine for a single Worker isolate / tests. Use a
 *  durable store (KV, Durable Object, Postgres) in production. */
export function memoryNullifierStore(): NullifierStore {
  const spent = new Set<string>();
  return {
    async has(n) { return spent.has(n); },
    async add(n) { spent.add(n); },
    async remove(n) { spent.delete(n); },
    /** Atomic on a single JS isolate: the check and the set can't interleave. */
    async addIfAbsent(n) {
      if (spent.has(n)) return false;
      spent.add(n);
      return true;
    },
  };
}
