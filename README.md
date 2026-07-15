# null-402 — private pay-per-call on Avalanche (monorepo)

> **x402, but the payment is a zero-knowledge proof.** An API request pays with a
> Groth16 proof verified **on-chain** by a Solidity contract on Avalanche — so no
> wallet, amount, or endpoint is revealed. Built for agents: an autonomous agent
> escrows once, then pays per call privately.

This is a **single-tree copy** of the null-402 project — every component in one
place. Migrated from Stellar/Soroban to **Avalanche Fuji (EVM)**.

Everything here is **real and verifiable on Avalanche Fuji** — no mocks.

## The idea

Standard x402 broadcasts who paid, how much, and which API. null-402 replaces the
payment with a **ZK proof of an unspent note in a shielded pool**. Only a
nullifier and a `valid:true` boolean ever touch the chain.

```
deposit  →  agent escrows nUSD into the Pool, commits a private note   (on-chain, public)
prove    →  agent generates a Groth16 proof locally: "I own an unspent note ≥ price,
            bound to THIS gateway + request"                          (secrets stay local)
verify   →  gateway calls the Solidity verifier (eth_call) → valid:true  (on-chain, ~0 fee) → 200
settle   →  operator pays the provider from the Pool, burns the nullifier (on-chain)
```

## Packages

| Package | Role |
|---|---|
| [`null-402-sdk`](./null-402-sdk) | TypeScript SDK — prover, gate, verifiers, on-chain pool helpers (viem) |
| [`null-402-contracts`](./null-402-contracts) | **Solidity** Null402Pool + Groth16 verifier (Foundry) |
| [`null-402-circuits`](./null-402-circuits) | Circom Groth16 payment circuit (chain-agnostic) |
| [`null-402-gateway`](./null-402-gateway) | Reference edge gateway (Hono) — real live prices, no mocks |
| [`null-402-dashboard`](./null-402-dashboard) | Public-vs-private demo UI (in-browser snarkjs proving) |
| [`null-402-mcp`](./null-402-mcp) | **MCP server** — any agent (Claude, …) pays privately; + Groq autonomous demo |
| [`null-402-examples`](./null-402-examples) | Agentic on-chain demo + full e2e demo |
| [`null-402-docs`](./null-402-docs) · [`null-402-landing`](./null-402-landing) | Docs + landing |

## Deployed on Avalanche Fuji (43113)

| | address |
|---|---|
| Groth16 verifier (BN254) | [`0x0b44836dDc460f589ce4EB97f276e533A2bE6060`](https://testnet.snowtrace.io/address/0x0b44836dDc460f589ce4EB97f276e533A2bE6060) |
| Pool (escrow + nullifiers) | [`0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C`](https://testnet.snowtrace.io/address/0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C) |
| Token (nUSD test ERC-20) | [`0xabea27277b0189c4C054020Ea609060A9292Ee9C`](https://testnet.snowtrace.io/address/0xabea27277b0189c4C054020Ea609060A9292Ee9C) |

## Run the whole thing

```bash
(cd null-402-circuits && npm i && npm run build)          # circuit + proving artifacts
(cd null-402-sdk      && npm i && npm run build)          # SDK → dist (viem)
(cd null-402-gateway  && npm i && npm run build)          # gateway → dist
(cd null-402-contracts && forge test)                     # Solidity pool + verifier tests
# deploy: PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url fuji --broadcast

# the headline: an agent pays for an API call privately, verified on Avalanche
(cd null-402-mcp && NULL402_PROVIDER=0x... NULL402_OPERATOR_SECRET=0x... \
   NULL402_FUNDER_KEY=0x... npm run selftest)
```

## Tests — verified, all passing

| Package | Command | Result |
|---|---|---|
| `null-402-contracts` | `forge test` | **22/22** |
| `null-402-sdk` | `npm test` | **42/42** (flow 7 + unit 25 + note-commitment 10) |
| `null-402-sdk` | `npm run test:real` | **4/4** (real snarkjs Groth16 proof) |
| `null-402-gateway` | `npm test` | **7/7** (dev-mode http 4 + `VERIFY_MODE=evm` http-evm 3) |
| `null-402-mcp` | `npm test` | **20/20** (tool handlers, mocked viem clients) |

Full reproducible matrix — coverage per suite, dev vs EVM verify modes, and
the opt-in live-Fuji check (`NULL402_RUN_LIVE_TESTS=1`) — is in
[`TESTING.md`](./TESTING.md).

## ZK stack

Circom + **Groth16 over BN254**, Poseidon Merkle tree (depth 20, 11,491
constraints). The circuit is chain-agnostic; the Solidity verifier is exported
from the same proving key via `snarkjs zkey export solidityverifier`, and the
BN254 pairing check runs on Avalanche via the standard precompiles (0x06/0x07/0x08).

MIT.
