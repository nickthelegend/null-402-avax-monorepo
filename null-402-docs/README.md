# null-402 — private pay-per-call on Avalanche

> **x402, but the payment is a zero-knowledge proof.** An API request pays with a
> Groth16 proof verified **on-chain** by a Solidity verifier on Avalanche Fuji — so
> no wallet, amount, or endpoint is revealed. Built for agents: an autonomous agent
> escrows nUSD once, then pays per call privately.

Everything below is **real and verifiable on Avalanche Fuji** — no mocks.

## The idea

Standard x402 broadcasts who paid, how much, and which API. null-402 replaces the
payment with a **ZK proof of an unspent note in a shielded pool**. Only a
nullifier and a `valid:true` boolean ever touch the chain.

```
deposit  →  agent escrows nUSD into the Pool, commits a private note   (on-chain, public)
prove    →  agent generates a Groth16 proof locally: "I own an unspent note ≥ price,
            bound to THIS gateway + request"                          (secrets stay local)
verify   →  gateway eth_calls the Solidity verifier → valid:true       (on-chain, ~0 fee)  → 200
settle   →  operator pays the provider from the Pool, burns the nullifier (on-chain)
```

## Packages (one monorepo)

| Package | Role |
|---|---|
| [`null-402-sdk`](../null-402-sdk) | TypeScript SDK (viem) — prover, gate, verifiers, on-chain pool helpers |
| [`null-402-contracts`](../null-402-contracts) | **Solidity** `Null402Pool` + `Groth16Verifier` (Foundry) |
| [`null-402-circuits`](../null-402-circuits) | Circom Groth16 payment circuit (BN254) |
| [`null-402-gateway`](../null-402-gateway) | Reference edge gateway (Hono / Cloudflare Worker) |
| [`null-402-dashboard`](../null-402-dashboard) | Public-vs-private demo UI |
| [`null-402-mcp`](../null-402-mcp) | **MCP server** — any agent (Claude, …) pays privately; + Groq autonomous demo |
| [`null-402-examples`](../null-402-examples) | Full e2e demo (`e2e-demo.mjs`) |
| [`null-402-landing`](../null-402-landing) · [`null-402-docs`](../null-402-docs) | Landing + docs |

## Agentic — pay privately from any agent

- **MCP server** (`null-402-mcp`): plug into Claude Desktop / Code (or any MCP
  client). Tools: `create_wallet`, `deposit`, `pay`. The agent pays x402 APIs
  privately — only a nullifier is revealed.
- **Groq autonomous demo**: a Groq LLM, given those tools, **autonomously** creates
  a wallet, deposits a note, and pays an x402 endpoint — the gateway verifies **and
  settles on-chain** (nUSD → provider, nullifier spent) — then the agent answers.
  Real value moves agent → pool → provider, privately.
- **Dashboard** generates a **real Groth16 proof in the browser** (snarkjs) and
  verifies it against the deployed EVM verifier (`valid:true`).

## Deployed on Avalanche Fuji (43113)

| | address |
|---|---|
| Verifier (Groth16 / BN254) | [`0x0b44836dDc460f589ce4EB97f276e533A2bE6060`](https://testnet.snowtrace.io/address/0x0b44836dDc460f589ce4EB97f276e533A2bE6060) |
| Pool (escrow + nullifiers) | [`0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C`](https://testnet.snowtrace.io/address/0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C) |
| Token (nUSD) | [`0xabea27277b0189c4C054020Ea609060A9292Ee9C`](https://testnet.snowtrace.io/address/0xabea27277b0189c4C054020Ea609060A9292Ee9C) |

The **settle** tx runs the BN254 pairing on-chain (`verify → true`), spends the
nullifier, and pays the provider — revealing only a nullifier, not the agent.

## Test matrix — all green

| Suite | Command | Result |
|---|---|---|
| Contracts (unit + cross-contract integration) | `forge test` | **22/22** |
| SDK — dev flow + unit + note-commitment | `npm test` | **42/42** |
| SDK — real Groth16 (prove + verify off-chain) | `npm run test:real` | **4/4** |
| SDK — live on-chain verify (Fuji, opt-in) | `NULL402_RUN_LIVE_TESTS=1 npm run test:live` | verified |
| Gateway — HTTP (dev) + real EVM verify path | `npm test` | **7/7** |
| MCP — tool handlers (mocked chain) | `npm test` | **20/20** |
| End-to-end demo | `node e2e-demo.mjs` | full flow, privacy held |

See [`../TESTING.md`](../TESTING.md) for the complete, reproducible matrix.

## ZK stack

Circom + **Groth16 over BN254**, Poseidon Merkle tree. Chosen for the cheapest
on-chain verification (runs per call) — EVM has native BN254 precompiles
(`0x06`/`0x07`/`0x08`) — smallest proofs, and battle-tested browser/Node proving
(snarkjs).

## Privacy model

A **Privacy-Pool** design. All deposits share **one Poseidon Merkle tree**, so
every payment proves membership in the same tree and every settlement references
the **same root** — only a nullifier distinguishes spends, and a nullifier can't
be linked to a deposit. So settlements are **unlinkable across all deposits**: the
anonymity set is the number of deposits. Deposits themselves are public (like any
pool).

The gateway accepts only proofs whose root equals the **actual on-chain commitment
tree** (computed off-chain, since neither EVM nor Stellar exposes a cheap Poseidon
host function — auditable; the one remaining trust assumption).

## Run the whole thing

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
(cd null-402-circuits && npm i && npm run build)
(cd null-402-sdk      && npm i && npm run build && npm test)   # 42/42
(cd null-402-gateway  && npm i && npm run build && npm test)   # 7/7
(cd null-402-contracts && forge test)                          # 22/22
(cd null-402-mcp      && npm i && npm test)                    # 20/20
(cd null-402-examples && npm run demo)                         # full flow
```

MIT.
