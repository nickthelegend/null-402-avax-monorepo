# null-402-gateway

Reference edge gateway for **null-402**, built on the [`null-402`](../null-402-sdk)
SDK. A Cloudflare Worker (Hono.js) that gates paid endpoints behind a
zero-knowledge payment proof — only a `valid` boolean ever gates access.

```bash
npm install                  # pulls the SDK via file:../null-402-sdk
cp .env.example .env         # set PAYMENT_PAYTO; VERIFY_MODE=dev for Phase 1
npm run dev                  # → http://localhost:8787
```

## Endpoints

| Route | Gate | Data |
|---|---|---|
| `GET /v1/price/:symbol` | 0.001 tier | **real** spot price — Coinbase public API (no key) |
| `GET /v1/listings` | 0.002 tier | **real** top-10 by market cap — CoinGecko public API (no key) |
| `GET /health` | free | — |
| `POST /api/demo/trigger` | free | public-vs-private contrast for the dashboard |

Prices are **live and unmocked** — paid routes fetch real data from public,
no-auth endpoints and return `502` if the upstream is unavailable (never fake
numbers). The response carries `"source": "coinbase"` / `"coingecko"`.

## Verify modes

- `VERIFY_MODE=soroban` — **real on-chain Groth16 verification.** The gateway
  simulates `verify()` on the deployed [verifier](../null-402-contracts) over
  Soroban RPC; the BN254 pairing runs on Avalanche. Needs `VERIFIER_CONTRACT_ID`
  (a live testnet one ships in `.env.example`) + `STELLAR_SOURCE_ACCOUNT`.
  Proven end-to-end against testnet: `npm run test:soroban`.
- `VERIFY_MODE=dev` — insecure local scaffold (no chain). Requires
  `DEV_SHARED_SECRET`. Never use in production.

## Gateway-managed pool state

While Stellar lacks an on-chain Poseidon host function, the gateway maintains the
trust-minimized state off-chain over the trustless on-chain verifier:

- **Nullifiers** → KV, keyed on the proof nullifier only (never a wallet or tx),
  24h TTL. Replay is caught before the chain call.
- **Roots** → `KNOWN_ROOTS`: recent Pool Merkle roots the operator computes
  off-chain from on-chain deposits. Empty accepts any non-empty root (dev only).

No wallet, amount, or endpoint is ever logged.

## Tests

```
npm run test:http      # 402 → proof → 200 → replay, dev verifier   → 4/4
```

End-to-end in `VERIFY_MODE=soroban` (real proof → on-chain verify → `200`) is
exercised by [`null-402-examples`](../null-402-examples): `node e2e-demo.mjs` and
`node agent.mjs` drive the real gateway app against the deployed testnet verifier.
A real run returns `200 OK · X-Privacy=zk-groth16`, with replay → `402`,
tampered → `402` (pairing fails on-chain), wrong-recipient → `400`.
