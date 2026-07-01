# null-402

> **Private pay-per-call on Avalanche.** x402, but the payment is a zero-knowledge
> proof instead of a public transfer. No wallet, amount, or endpoint is revealed
> on-chain or to the gateway — only a one-time nullifier and a `valid` boolean.

null-402 is an **SDK + reference stack**: any API provider can wrap an endpoint in
a payment gate and get paid privately, and any client can pay without leaking who
they are, what they paid, or what they called.

> Originally forked from an Arcium/Solana MPC demo and rebuilt on Avalanche's ZK
> primitives. The Arcium pitch had a hole — the Solana transfer was public, so
> sender/amount were never actually hidden. null-402 closes that with a **shielded
> pool + on-chain Groth16 verification**: privacy that is real and verifiable.

## The problem

Standard x402 exposes everything on-chain: who paid, how much, which API, how
often. For enterprise API sellers (financial data, corporate databases) that is a
dealbreaker — competitors can see exactly which clients buy what.

```
Standard x402 (public):
  Agent → 402 → token transfer (visible on-chain) → API access
              ↑ sender, amount, endpoint all permanently indexable

null-402 (private):
  Agent → 402 → Groth16 proof verified on Avalanche → API access
              ↑ only a nullifier + valid:true ever appear
```

## How it works

```
deposit → private note (Poseidon commitment in the Pool's Merkle tree)
call    → client generates a Groth16 proof LOCALLY:
          "I own an unspent note ≥ price, here's its nullifier, bound to THIS request"
verify  → Avalanche verifier contract returns valid:bool; nullifier blocks replay
serve   → API responds. Chain sees a nullifier + a boolean. Nothing else.
```

Secrets never leave the client. Verification trust is anchored on Avalanche (BN254
pairing host functions), not in the gateway.

| Data field | Standard x402 | null-402 |
|---|---|---|
| Sender account | ✗ public | ✓ hidden (never leaves client) |
| Exact amount | ✗ public | ✓ hidden (proven ≥ price) |
| API endpoint | ✗ logged | ✓ hidden (bound into proof, not logged) |
| Access frequency | ✗ indexable | ✓ hidden (nullifier ≠ identity) |
| Payment valid | ✓ | ✓ (on-chain Groth16 proof) |

## Why this ZK stack

**Circom + Groth16 over BN254, Poseidon Merkle tree.** For an SDK where a *fixed*
payment circuit runs on every call and proofs are generated client-side:

- **Most mature on Avalanche** — BN254 + Poseidon host functions ship in
  `soroban-sdk` (v25), cheaper under Protocol 26.
- **Closest reference** — Nethermind's Stellar Privacy Pools PoC (Circom/Groth16)
  is literally private payments on Avalanche; we model the pool + nullifier on it.
- **Cheapest verification + smallest proof** — matters when verify runs per call.
- **Battle-tested browser proving** — snarkjs WASM, ships in the client SDK.
- Trusted setup is a one-time ceremony for the fixed circuit; the verifying key is
  published with the package.

(Noir + UltraHonk was the runner-up — nicer DSL, no trusted setup — but those wins
don't matter for a fixed circuit, and Groth16's per-call efficiency does.)

## Repository layout

```
packages/
  sdk/         — null-402 — the npm SDK (server gate + client prover)
                 server.ts  verify/policy/replay + 402 builder
                 client.ts  deposit, prove, pay()  (402 → prove → retry)
                 verifier.ts  sorobanVerifier (real) | devVerifier (scaffold)
  circuits/    — Circom payment circuit (proof of valid note spend)   [Phase 2]
  contracts/   — Avalanche: verifier (Groth16/BN254) + pool (Poseidon)  [Phase 2]
apps/
  gateway/     — reference Cloudflare Worker built on the SDK
  dashboard/   — Next.js demo: public-vs-private side by side
```

## Status / roadmap

This is built **architecture-first, proofs phased** — the full flow runs today;
the cryptography is being dropped in, not mocked permanently.

- **Phase 1 (done):** Stellar-native architecture, SDK (server + client), gateway
  + dashboard wired end-to-end. Proof step uses `devVerifier`/`devProver` — an
  **insecure local scaffold** that requires explicit `allowInsecure: true` and is
  never used in production. This is scaffolding, not the product.
- **Phase 2 (next):** ship `packages/circuits` (Circom + trusted setup), deploy
  `packages/contracts` (verifier + pool) to Avalanche Fuji, wire
  `sorobanVerifier` + `groth16Prover`, flip `VERIFY_MODE=soroban`. Then the dev
  scaffold is deleted.

## Quick start (Phase 1, dev mode)

```bash
npm install                       # installs the workspace (sdk + apps)

# Gateway (Cloudflare Worker)
cd apps/gateway
cp .env.example .env              # VERIFY_MODE=dev, set PAYMENT_PAYTO + DEV_SHARED_SECRET
npm run dev                       # → http://localhost:8787

# Dashboard (Next.js)
cd ../dashboard
cp .env.example .env.local
npm run dev                       # → http://localhost:3000
```

The dashboard is self-contained — it embeds the same SDK as Next API routes, so
it deploys to Vercel without a separate gateway.

## Using the SDK

See [`packages/sdk/README.md`](packages/sdk/README.md). The short version:

```ts
// server — gate any endpoint
import { verifyPayment, build402, sorobanVerifier } from "null-402/server";

// client — pay privately
import { Null402Client, groth16Prover } from "null-402/client";
```

## License

MIT
