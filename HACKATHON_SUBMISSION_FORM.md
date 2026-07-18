# null-402 — Hackathon submission (copy-paste answers)

---

## GENERAL SECTION

### Project name
```
null-402
```

### Short and engaging overview
```
x402, but the payment is a zero-knowledge proof. null-402 lets an AI agent pay
per API call on Avalanche without revealing its wallet, the amount, or which
endpoint it hit — the "payment" is a Groth16 proof verified on-chain by a
Solidity contract on Fuji. Only a nullifier and valid:true ever touch the chain.
```

### Describe your project in detail
```
THE PROBLEM

The x402 standard revived a beautiful idea: HTTP 402 Payment Required, so
machines can pay for resources per call. But x402 pays on a public ledger. Every
request broadcasts who paid, how much, and which API they called. For an
autonomous AI agent that makes thousands of calls a day, that is a permanent,
public behavioural log: your agent's data sources, its query volume, its
spending, and its strategy — readable by any competitor. Metadata is the leak,
even when the content is private.

WHAT null-402 DOES

null-402 keeps the x402 request/response flow exactly as developers know it, and
replaces the payment itself with a zero-knowledge proof of an unspent note in a
shielded pool on Avalanche.

  deposit  →  the agent escrows nUSD into the Pool once and commits a private
              note (on-chain, public — this is the only public step)
  prove    →  for each call, the agent generates a Groth16 proof locally:
              "I own an unspent note worth >= this price, bound to THIS gateway
              and THIS request." Secrets never leave the client.
  verify   →  the gateway verifies the proof against the on-chain Solidity
              verifier via eth_call — no gas, no transaction, sub-second → 200 OK
  settle   →  the operator later pays the provider from the Pool and burns the
              nullifier on-chain, so a proof can never be replayed.

The result: the API gets paid, the payment is verifiable on Avalanche, and the
chain never learns the payer's identity, the amount, or the endpoint. Requests
are unlinkable to each other and to the deposit.

WHY IT MATTERS FOR AGENTS

This is built agent-first, not human-first. null-402 ships an MCP server, so any
MCP-capable agent (Claude, or any LLM client) gains private pay-per-call as a
native tool — the agent calls a paid API, and the payment proof is generated,
verified on Avalanche, and settled without a human touching a wallet. We also
ship an autonomous demo where an agent escrows once and then pays for a stream of
calls entirely on its own.

WHAT IS LIVE ON AVALANCHE FUJI

Everything is real and verifiable on-chain — no mocks, no simulated proofs.

  Groth16 verifier (BN254)  0x0b44836dDc460f589ce4EB97f276e533A2bE6060
  Pool (escrow + nullifiers) 0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C
  nUSD test token (ERC-20)   0xabea27277b0189c4C054020Ea609060A9292Ee9C
  Chain: Avalanche Fuji C-Chain (43113)

Why Avalanche is the right chain for this: verification is a BN254 pairing check
via EVM precompiles, and Fuji's sub-second finality and near-zero fees are what
make per-call settlement economically sane. A pay-per-call primitive is only
viable if settling a fraction of a cent doesn't cost more than the call itself.

TEST COVERAGE (all green, reproducible)

  null-402-contracts   forge test        22/22
  null-402-sdk         npm test          42/42
  null-402-sdk         npm run test:real  4/4  (real snarkjs Groth16 proofs)
  null-402-gateway     npm test           7/7  (incl. VERIFY_MODE=evm on Fuji)
  null-402-mcp         npm test          20/20

HONEST SCOPE

Settlement is operator-gated today (the operator submits the settle transaction
that burns the nullifier and pays the provider) — the proof, the nullifier, and
the anti-replay guarantee are all fully on-chain and trustless; the operator
cannot forge a payment or steal a note, only sequence settlements. Decentralising
the operator into a permissionless settler set is the production follow-up. It is
testnet-only and unaudited.
```

### Select tracks
```
Privacy  (primary — the entire project is a privacy primitive)
+ any AI / autonomous-agent track (the MCP server + autonomous agent demo)
+ any DeFi / payments / infrastructure track (private x402 pay-per-call rails)
```
> Pick these from the event's actual track list — the project genuinely fits
> Privacy first, then Agents/AI, then Payments/Infra.

---

## TECHNICAL DETAILS

### Describe the tech stack, APIs, and integrations used. Mention any innovative solutions or "hacky" parts worth highlighting.
```
ARCHITECTURE (monorepo, 9 packages)

  null-402-circuits    Circom Groth16 payment circuit (BN254) + proving artifacts
  null-402-contracts   Solidity: Null402Pool + Groth16Verifier (Foundry)
  null-402-sdk         TypeScript SDK — prover, gate, verifiers, pool helpers (viem)
  null-402-gateway     Reference edge gateway (Hono) — real live prices, no mocks
  null-402-dashboard   Public-vs-private demo UI (in-browser snarkjs proving)
  null-402-mcp         MCP server — any agent pays privately + Groq autonomous demo
  null-402-examples    Agentic on-chain demo + full end-to-end demo
  null-402-docs / -landing

STACK

  Chain        Avalanche Fuji C-Chain (43113)
  Contracts    Solidity, Foundry (forge test / forge script)
  ZK           Circom 2 + snarkjs, Groth16 over BN254
  Client       TypeScript, viem, Hono, Node 22
  Agent        Model Context Protocol (MCP) server; Groq for the autonomous demo
  Proving      snarkjs — runs in Node AND in the browser (dashboard proves in-tab)

THE INNOVATIVE PART: VERIFICATION COSTS NOTHING

The gateway does not send a transaction to check a payment. It calls the deployed
Solidity verifier with eth_call — a read-only EVM execution against Fuji state.
The BN254 pairing check runs on the EVM precompiles, returns valid:true, and the
gateway answers 200 — with zero gas and no on-chain footprint per request. The
chain is only touched twice in a note's whole life: once at deposit and once at
settle. That is what makes per-call ZK payments affordable; a scheme that needed
a transaction per call would cost more in gas than the API call is worth.

BINDING THE PROOF TO THE REQUEST (the anti-replay design)

A naive "proof of funds" is replayable — capture it once, reuse it forever. Our
circuit takes the gateway identity and a request-scoped value as public inputs,
so a proof is cryptographically bound to one gateway and one request. Combined
with the nullifier burned on-chain at settle, a note can be spent exactly once
and a proof can't be lifted and reused against another endpoint.

THE HACKY PART WORTH HIGHLIGHTING

Porting the ZK layer from Stellar to Avalanche was a curve migration, not a
recompile. The Stellar version used BLS12-381 (what Soroban's host functions
expose). Standard EVM has precompiles for BN254, not BLS12-381 — so the circuits
had to be rebuilt on BN254, the trusted-setup artifacts regenerated, and the
verifier re-exported as Solidity. Getting the proof-encoding byte order right
across snarkjs → Solidity (G2 coordinates are imaginary-part-first in EIP-197,
which is the opposite of the naive ordering) was the single fiddliest part of the
migration, and it fails silently — an incorrectly ordered proof simply returns
false with no error to debug. We now assert the encoding in the test suite.

REAL PRICES, NO MOCKS

The reference gateway serves live price data — the demo pays for something real,
so the "did the payment actually work" question is answered by a real response
body, not a stub.
```

### Select the technologies you used
```
Solidity · TypeScript · JavaScript · Circom · Foundry · Node.js · viem ·
snarkjs / Groth16 · Hono · Avalanche (Fuji C-Chain) · Model Context Protocol (MCP)
```

### GitHub link
```
https://github.com/nickthelegend/null-402-avax-monorepo
```

### Project links
```
https://github.com/nickthelegend/null-402-avax-monorepo
https://testnet.snowtrace.io/address/0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C
https://testnet.snowtrace.io/address/0x0b44836dDc460f589ce4EB97f276e533A2bE6060
```
> Add your demo-video URL and, if you deploy the dashboard/landing, its live URL.

---

## PROJECT CONTINUITY & DEVELOPMENT

### Is your project built upon an existing idea? — YES. Full disclosure:
```
PRE-EXISTING (built before this hackathon)

null-402 previously existed as a Stellar/Soroban project. What carried over
conceptually is the core idea ("x402 where the payment is a ZK proof"), the
Circom circuit's logical design, and the general package layout of the monorepo.

BUILT DURING THIS HACKATHON (everything below is new work)

1. ENTIRE ON-CHAIN LAYER, REWRITTEN FOR EVM
   The Soroban Rust contracts were replaced with new Solidity contracts:
   Null402Pool (deposits, commitments, nullifier registry, operator settlement)
   and a Groth16Verifier. New Foundry project, new deploy scripts, deployed to
   Avalanche Fuji. 22/22 forge tests written from scratch.

2. ZK CIRCUITS MIGRATED BLS12-381 → BN254
   Stellar's Soroban exposes BLS12-381 host functions; standard EVM has BN254
   precompiles. The circuits were rebuilt on BN254, the trusted setup re-run, new
   proving/verifying keys generated, and the verifier re-exported as Solidity.
   This was not a config flag — it is a different curve and a different
   proof-encoding contract with the Solidity verifier.

3. SDK REWRITTEN FROM STELLAR SDK → viem/EVM
   Every chain touchpoint is new: pool helpers, deposit, nullifier lookups, and
   crucially the gas-free eth_call verification path against the Fuji verifier.

4. GATEWAY REWORKED FOR EVM VERIFICATION
   Added VERIFY_MODE=evm — the gateway verifies proofs against the live Fuji
   contract instead of a local verifier.

5. MCP SERVER — NEW IN THIS HACKATHON
   The agent-native surface did not exist before. Any MCP-capable agent can now
   pay for API calls privately on Avalanche as a native tool, plus an autonomous
   Groq-driven agent demo that escrows once and pays per call with no human.

6. FULL TEST SUITE — NEW
   22/22 contracts, 42/42 SDK unit, 4/4 real-proof, 7/7 gateway, 20/20 MCP.

7. SECURITY HARDENING PASS
   An adversarial review of the new Solidity pool produced fixes that were
   implemented and redeployed during the hackathon.

SUMMARY: the idea and the circuit logic are pre-existing; 100% of the Avalanche
implementation — contracts, curve migration, SDK, gateway EVM path, MCP agent
layer, and the entire test suite — was built during this hackathon.
```
