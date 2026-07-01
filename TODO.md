# null-402 — TODO

Status of the Avalanche (Fuji) migration. ✓ = done & verified on-chain / in tests.

## Contracts (Solidity / Foundry)
- [x] `Groth16Verifier.sol` exported from the payment circuit (snarkjs)
- [x] `Null402Pool.sol` — deposit + settle (verify → burn nullifier → pay)
- [x] `MockUSD.sol` escrow/payout ERC-20
- [x] Foundry tests: real proof on-chain, settle, replay, auth, tamper — **5/5**
- [x] Deploy script + deployed to Fuji (verifier / pool / nUSD)

## SDK (viem)
- [x] `evm.ts`: `poolDeposit` / `poolCommitments` / `poolSettle`
- [x] `evmVerifier` (on-chain verify via `eth_call`)
- [x] Removed `@stellar/stellar-sdk`; circuit/prover/witness code reused as-is
- [x] flow.test 7/7 · real-proof.test 4/4 · evm-live (verify + settle on Fuji) ✓

## Gateway
- [x] `selectVerifier` → `evmVerifier`; `Env` → EVM vars; `VERIFY_MODE=evm`
- [x] http test **4/4** (health / 402 / paid-200 / replay)

## MCP + agent
- [x] Wallet: Stellar Keypair → EVM key; funder tops up gas; self-mint nUSD
- [x] `deposit` / `pay` on the EVM SDK; on-chain settle via operator
- [x] Keyless autonomous agent (`src/agent.mjs`) over MCP stdio — verified live
- [x] Groq LLM agent path (`agent:groq`) rebranded

## Examples / docs
- [x] `e2e-demo.mjs` migrated + passing (on-chain verify, privacy/replay/tamper)
- [x] Removed superseded Stellar example scripts (MCP agent is canonical)
- [x] READMEs + dashboard UI rebranded Stellar → Avalanche

## Next
- [ ] Trust-minimized settlement (remove trusted relayer)
- [ ] Durable nullifier/root store for production gateways
- [ ] Deposit-side unlinkability (relayer/batched deposits)
- [ ] Wire the dashboard browser demo to `evmVerifier` on Fuji
