/**
 * Embedded gateway for the demo's Next API routes — backed by the null-402 SDK.
 *
 * Same SDK the standalone Cloudflare Worker uses; here it runs as Next edge
 * routes so the dashboard is self-contained (no CORS, deploys to Vercel alone).
 * Uses the dev verifier (Phase 1). Swap to sorobanVerifier once contracts deploy.
 */

import {
  build402,
  verifyPayment,
  devVerifier,
  memoryNullifierStore,
  type GateConfig,
} from "null-402/server";

const PAYTO = process.env.PAYMENT_PAYTO ?? "G_DEMO_GATEWAY_ACCOUNT";
const DEV_SECRET = process.env.DEV_SHARED_SECRET ?? "change_me_dev_only";

// Per-isolate nullifier store. Fine for a demo; use a durable store in prod.
const nullifiers = memoryNullifierStore();

export function gateConfig(requiredAmount: number, description: string): GateConfig {
  return {
    requiredAmount,
    payTo: PAYTO,
    description,
    verifier: devVerifier({ sharedSecret: DEV_SECRET, allowInsecure: true }),
    nullifiers,
    isKnownRoot: async (root) => root.length > 0,
  };
}

export { build402, verifyPayment, PAYTO };
