/// <reference types="@cloudflare/workers-types" />
/**
 * KV-backed nullifier store (replay prevention).
 *
 * Keyed on the proof NULLIFIER only — never a wallet, amount, or endpoint. A
 * spent nullifier is stored with a 24h TTL; that is ample because proofs are
 * request-bound and expire long before then.
 */

import type { NullifierStore } from "null-402/server";

const TTL_SECONDS = 86_400; // 24h

export function kvNullifierStore(kv: KVNamespace): NullifierStore {
  return {
    async has(nullifier) {
      return (await kv.get(`nf:${nullifier}`)) !== null;
    },
    async add(nullifier) {
      await kv.put(`nf:${nullifier}`, "1", { expirationTtl: TTL_SECONDS });
    },
    async remove(nullifier) {
      await kv.delete(`nf:${nullifier}`);
    },
    /**
     * Best-effort atomic claim. Cloudflare KV has no compare-and-set, so this is
     * a get-then-put and is not strongly consistent across colos — it narrows,
     * but cannot fully close, a concurrent double-claim. The authoritative
     * single-use guard remains on-chain in the Pool's settle() (nullifier burn),
     * with the gateway's on-chain isSpent pre-check (isSpentOnChain) as a second
     * layer. Returns true iff this call was the one that wrote the key.
     */
    async addIfAbsent(nullifier) {
      const key = `nf:${nullifier}`;
      if ((await kv.get(key)) !== null) return false;
      await kv.put(key, "1", { expirationTtl: TTL_SECONDS });
      return true;
    },
  };
}
