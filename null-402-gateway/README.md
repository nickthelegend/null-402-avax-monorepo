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

- `VERIFY_MODE=evm` (default) — **real on-chain Groth16 verification.** The gateway
  `eth_call`s `verifyProof()` on the deployed [verifier](../null-402-contracts) over
  Avalanche Fuji RPC; the BN254 pairing runs on-chain. Needs `VERIFIER_CONTRACT_ID`
  (a live Fuji one ships in `.env.example`) + `EVM_RPC_URL` + `EVM_CHAIN_ID` (43113).
  The real EVM code path is covered by `test/http-evm.test.mts` (against a local
  stub JSON-RPC): `npm test`.
- `VERIFY_MODE=dev` — insecure local scaffold (no chain). Requires
  `DEV_SHARED_SECRET`. Never use in production.

## Gateway-managed pool state

Neither EVM nor Stellar exposes a cheap on-chain Poseidon; the gateway maintains
the trust-minimized state off-chain over the trustless on-chain verifier:

- **Nullifiers** → KV, keyed on the proof nullifier only (never a wallet or tx),
  24h TTL. Replay is caught before the chain call.
- **Roots** → `KNOWN_ROOTS`: recent Pool Merkle roots the operator computes
  off-chain from on-chain deposits. Empty accepts any non-empty root (dev only).

No wallet, amount, or endpoint is ever logged.

## Tests

```
npm test               # http (dev) 4/4 + http-evm (real evm path) 3/3  → 7/7
npm run test:http      # 402 → proof → 200 → replay, dev verifier        → 4/4
```

`test/http-evm.test.mts` boots the real gateway app in `VERIFY_MODE=evm` against a
local stub JSON-RPC and asserts the real `evmVerifier`/`eth_call` code path:
accept → `200`, reject → `402`, unlisted root → unknown-root. A live end-to-end
run (`VERIFY_MODE=evm` against the deployed Fuji verifier) is exercised by
[`null-402-examples`](../null-402-examples). See `../TESTING.md` for the full matrix.
