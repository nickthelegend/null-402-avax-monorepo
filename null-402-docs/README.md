# null-402 — private pay-per-call on Avalanche

> **x402, but the payment is a zero-knowledge proof.** An API request pays with a
> Groth16 proof verified **on-chain** by a Soroban contract — so no wallet,
> amount, or endpoint is revealed. Built for agents: an autonomous agent escrows
> nUSD once, then pays per call privately.

Everything below is **real and verifiable on Avalanche Fuji** — no mocks.

## The idea

Standard x402 broadcasts who paid, how much, and which API. null-402 replaces the
payment with a **ZK proof of an unspent note in a shielded pool**. Only a
nullifier and a `valid:true` boolean ever touch the chain.

```
deposit  →  agent escrows nUSD into the Pool, commits a private note   (on-chain, public)
prove    →  agent generates a Groth16 proof locally: "I own an unspent note ≥ price,
            bound to THIS gateway + request"                          (secrets stay local)
verify   →  gateway simulates the Soroban verifier → valid:true       (on-chain, ~0 fee)  → 200
settle   →  operator pays the provider from the Pool, burns the nullifier (on-chain)
```

## The 8 repos

| Repo | Role |
|---|---|
| [`null-402-sdk`](https://github.com/shinothelegend/null-402-sdk) | TypeScript SDK — prover, gate, verifiers, on-chain pool helpers |
| [`null-402-contracts`](https://github.com/shinothelegend/null-402-contracts) | Soroban verifier + pool (Rust) |
| [`null-402-circuits`](https://github.com/shinothelegend/null-402-circuits) | Circom Groth16 payment circuit |
| [`null-402-gateway`](https://github.com/shinothelegend/null-402-gateway) | Reference edge gateway (Hono) |
| [`null-402-dashboard`](https://github.com/shinothelegend/null-402-dashboard) | Public-vs-private demo UI |
| [`null-402-mcp`](https://github.com/shinothelegend/null-402-mcp) | **MCP server** — any agent (Claude, …) pays privately; + Groq autonomous demo |
| [`null-402-examples`](https://github.com/shinothelegend/null-402-examples) | Agentic on-chain demo + full e2e demo |
| [`null-402-landing`](https://github.com/shinothelegend/null-402-landing) · [`null-402-docs`](https://github.com/shinothelegend/null-402-docs) | Landing + docs |

## Agentic — pay privately from any agent

- **MCP server** (`null-402-mcp`): plug into Claude Desktop / Code (or any MCP
  client). Tools: `create_wallet`, `deposit`, `pay`. The agent pays x402 APIs
  privately — only a nullifier is revealed.
- **Groq autonomous demo**: a Groq LLM, given those tools, **autonomously**
  creates a wallet, deposits a 1-XLM note, and pays an x402 endpoint — the gateway
  verifies **and settles on-chain** (1 nUSD → provider, nullifier spent) — then the
  agent answers. Real run: deposit `0ad8a311…`, settle `3969f955…`, `200 OK ·
  X-Privacy=zk-groth16`. Real value moves agent → pool → provider, privately.
- **Dashboard** generates a **real Groth16 proof in the browser** (snarkjs) and
  verifies it on the deployed Stellar verifier (`/api/verify` → `valid:true`).

## Deployed on Avalanche Fuji

| | id |
|---|---|
| Verifier (Groth16 / BN254) | [`CDCYYFSJ…WO32JQJLV`](https://testnet.snowtrace.io/contract/CDCYYFSJ7QC7RO6L2DHWK6X6IMZ5U5J3IEAKLKTBTBDX45LWO32JQJLV) |
| Pool (escrow + nullifiers) | [`CCVYSIWU…YS32C24XL`](https://testnet.snowtrace.io/contract/CCVYSIWUAOZYFVAM6R76DMKDY4Y52SFIPY6CX3HBMUFF5Q4YS32C24XL) |
| Token (native nUSD SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

### Real transactions

| What | tx |
|---|---|
| Verifier deploy | [`d6f10978…`](https://testnet.snowtrace.io/tx/d6f109783223f68dbd289b32e7e15ef22ea564fe1b8bff8a2cc841d5100d91a5) |
| Verifier `init(vk)` | [`75438a9d…`](https://testnet.snowtrace.io/tx/75438a9db154121356c2aa33ba4c10f9e8dd423d1bb16518c3f481e169c6514e) |
| Agent **deposit** (escrow nUSD) | [`447d0ef8…`](https://testnet.snowtrace.io/tx/447d0ef8427bf2ad161db726cb093167fa07ec4d686708c35c7bf56a406d3bd4) |
| Operator **settle** (verify → payout) | [`db18bb8e…`](https://testnet.snowtrace.io/tx/db18bb8e5dd0dd932d4bcb2609dcfc65148e18b56237bf958a8ffcaca24a91b0) |

The **settle** tx runs the BN254 pairing on-chain (returns `verify → true`),
spends the nullifier, and pays the provider — revealing only a nullifier, not the
agent.

## Test matrix — all green

| Suite | Command | Result |
|---|---|---|
| Contracts (unit + cross-contract integration) | `cargo test` | **10/10** |
| SDK — dev flow | `npm test` | **7/7** |
| SDK — real Groth16 (prove + verify off-chain) | `npm run test:real` | **4/4** |
| SDK — live on-chain verify (testnet) | `npm run test:soroban` | **2/2** |
| Gateway — HTTP 402→proof→200→replay | `npm run test:http` | **4/4** |
| Circuit — compile + trusted setup + verify | `npm run build` | proof verifies |
| End-to-end demo | `node e2e-demo.mjs` | full flow, privacy held |
| Agentic on-chain demo | `node agent.mjs` | deposit + pay + settle, real nUSD |

Highlights:
- **Contracts** `pool.settle` is a real cross-contract Groth16 verify + SAC-token
  payout + single-use nullifier — proven in `tests/pool.rs`.
- **SDK** generates a real proof and verifies it both off-chain (snarkjs) and
  **on the deployed testnet contract**.
- **Gateway** in `VERIFY_MODE=soroban` simulates `verify` on-chain; a real proof
  in `X-PAYMENT` returns `200`, replay/tampered/wrong-recipient are rejected.

## ZK stack

Circom + **Groth16 over BN254**, Poseidon Merkle tree (depth 20, 11,491
constraints). Chosen for the cheapest on-chain verification (runs per call),
smallest proofs, battle-tested browser/Node proving (snarkjs), and the most
mature Stellar host-function support.

## Privacy model

A **Privacy-Pool** design. All deposits share **one Poseidon Merkle tree**, so
every payment proves membership in the same tree and every settlement references
the **same root** — only a nullifier distinguishes spends, and a nullifier can't
be linked to a deposit. So settlements are **unlinkable across all deposits**: the
anonymity set is the number of deposits. Deposits themselves are public (like any
pool).

Verified: `node anonymity.mjs` deposits two notes and shows both proving against
**one shared root** on-chain — real unlinkability, not per-note trees.

The gateway accepts only proofs whose root equals the **actual on-chain commitment
tree** (computed off-chain, since Stellar has no Poseidon host fn yet — auditable;
the one remaining trust assumption, and the only thing standing between this and
fully-trustless).

## Run the whole thing

```bash
(cd null-402-circuits && npm i && npm run build)
(cd null-402-sdk      && npm i && npm run build)
(cd null-402-gateway  && npm i && npm run build)
(cd null-402-contracts && cargo test)                 # 10/10
(cd null-402-examples && node e2e-demo.mjs)           # full flow
(cd null-402-examples && node agent.mjs)              # agentic, on-chain
```

MIT.
