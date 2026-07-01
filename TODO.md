# null-402 — TODO

Working checklist. See [ROADMAP.md](ROADMAP.md) for the full plan.
**Do not commit until the owner says so.**

## ✅ Done — Phase 1 (dev-mode end-to-end)
- [x] `null-402-sdk`: `npm install` → `npm run build` (tsc clean, emits dist/)
- [x] `null-402-sdk`: `npm test` — 7/7 (happy, replay, no-payment, wrong-recipient,
      insufficient-amount, context-mismatch, tampered-proof)
- [x] `null-402-gateway`: `npm install` → `npm run typecheck` (clean)
- [x] `null-402-dashboard`: `npm install` → `npm run typecheck` (clean)
- [x] `null-402-gateway`: `npm run test:http` — 4/4 (402 → proof → 200 → replay)

## 🔴 Now — Phase 2 (real ZK)
- [x] `null-402-circuits/payment.circom` — membership + value≥price + nullifier + context
- [x] circuits: compile, Powers-of-Tau, groth16 setup, verifying key — **proof verifies**
- [x] SDK `groth16Prover` (snarkjs) + `localGroth16Verifier` — **real-proof test 4/4**
- [x] `null-402-contracts/verifier` — BN254 Groth16 pairing — **host test verifies real proof** (`cargo test`)
- [x] host-fn status: BN254 ✓ in soroban-sdk 26.1.0; **Poseidon NOT exposed yet**. target `wasm32v1-none`
- [x] **deploy verifier to testnet** (`CDCYYFSJ…`), init vk; verifies real proof on-chain (CLI)
- [x] SDK `sorobanVerifier` (Soroban RPC simulate) — **live testnet 2/2** (`npm run test:soroban`)
- [x] `null-402-contracts/pool` — deposit/escrow + on-chain nullifier set + cross-contract `settle`. **5 tests** (`cargo test` = 10/10 with verifier)
- [x] gateway `VERIFY_MODE=soroban` end-to-end (gateway-managed `KNOWN_ROOTS` + KV nullifiers)
- [x] **e2e demo** `null-402-examples/e2e-demo.mjs` — real proof → gateway → on-chain verify; privacy assertion held; replay/tamper/wrong-recipient rejected
- [ ] (optional) dashboard real in-browser proving; fully-trustless on-chain tree when Poseidon host fn ships

## 🟢 Later — Phase 3/4
- [ ] deploy verifier + pool to testnet; `VERIFY_MODE=soroban`
- [ ] dashboard: real browser proving + deposit/pay UX
- [ ] security review (replay, root window, context binding, DoS, malformed proofs)
- [ ] publish `null-402` to npm; drop `file:` deps
- [ ] examples: node-server, agent-client, next-route
- [ ] docs: protocol + circuit + contract + threat model
- [ ] mainnet checklist; landing polish

## Notes
- Phase 1 proof step is an explicit insecure scaffold (`allowInsecure:true`) — temporary.
- Gateway/dashboard depend on the SDK via `file:../null-402-sdk` (dev only).
