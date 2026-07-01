# null-402 — Roadmap

**Private pay-per-call on Avalanche.** x402, but the payment is a zero-knowledge
proof verified on-chain — only a one-time nullifier and a `valid` boolean are ever
revealed. The product is an **SDK**; everything else is reference + demo.

## Repos (all independent, branch `main`, uncommitted until you say so)

| Repo | Role | Stack |
|---|---|---|
| `null-402-sdk` | The npm package `null-402` — server gate + client prover | TypeScript · snarkjs |
| `null-402-contracts` | Avalanche shielded pool + Groth16 verifier | Rust · BN254 · Poseidon |
| `null-402-circuits` | Circom payment circuit (proof of valid note spend) | Circom · Groth16 |
| `null-402-gateway` | Reference edge gateway built on the SDK | Cloudflare Workers · Hono |
| `null-402-dashboard` | Live demo: public vs private, side by side | Next.js 15 · React 19 |
| `null-402-landing` | Marketing one-pager | Static HTML |
| `null-402-docs` | Protocol / circuit / contract / SDK docs | Markdown |
| `null-402-examples` | Runnable SDK examples | TypeScript |

## Privacy model

Shielded pool, not "a proof about a public payment":

```
deposit → private note (Poseidon commitment in the Pool's Merkle tree)
call    → client proves locally: "I own an unspent note ≥ price, bound to THIS request"
verify  → Avalanche verifier returns valid:bool; nullifier blocks replay
serve   → chain sees a nullifier + a boolean. Nothing else.
```

## ZK stack decision

**Circom + Groth16 over BN254, Poseidon Merkle tree.** Chosen over Noir/UltraHonk:
the circuit is fixed (one-time trusted setup is fine), Groth16 has the cheapest
per-call verification + smallest proof, snarkjs gives battle-tested browser
proving, and Nethermind's Stellar Privacy Pools PoC is the closest working
reference to model the pool + nullifier on.

---

## Phases

### Phase 0 — Repos & scaffold ✅ DONE
- Pivoted from the Arcium/Solana fork; removed Solana + Arcium entirely.
- Split into 8 independent repos, each `git init`'d on `main` (0 commits).
- Cross-repo dep: gateway + dashboard consume the SDK via `file:../null-402-sdk`.

### Phase 1 — Architecture + dev-mode end-to-end ✅ DONE
Goal: the whole flow runs, with the proof step on an explicit **dev scaffold**
(`devVerifier`/`devProver`, gated behind `allowInsecure:true`) — NOT a permanent
mock, just temporary so we can build before the circuit exists.
- [x] SDK: types, proof transport, verifier abstraction, server gate, client.
- [x] Gateway rewired to the SDK + Stellar; nullifier replay store (KV).
- [x] Dashboard rebranded + embedded SDK routes.
- [x] Install + build the SDK; typecheck gateway + dashboard (all clean).
- [x] SDK end-to-end test (`npm test` in null-402-sdk) — 7/7: happy path, replay,
      no-payment, wrong-recipient, insufficient-amount, context-mismatch, tampered.
- [x] Gateway in-process HTTP test (`npm run test:http`) — 4/4: 402 → proof → 200
      → replay-rejected, privacy headers present. (Direct app.fetch, no wrangler.)

### Phase 2 — Real zero-knowledge (the crypto) ⏳ IN PROGRESS
Replace the dev scaffold with real proofs. Delete `devVerifier`/`devProver`.
- [x] `null-402-circuits`: `payment.circom` written (Poseidon membership + value≥price
      + nullifier + payTo/context binding); compiled; Powers-of-Tau `2^14` + groth16
      setup; **a real proof verifies** (`npm run build`). 11,491 constraints.
- [x] SDK `groth16Prover` (snarkjs + circomlibjs, real proofs) + `localGroth16Verifier`
      (real off-chain snarkjs verify). Field-encoded `payTo`/`contextHash`. **Real-proof
      test 4/4** (`npm run test:real`): prove→verify, accept via verifyPayment(mode=local),
      tampered rejected, underfunded note unprovable. Dev/gateway tests still green.
- [x] `null-402-contracts/verifier`: BN254 Groth16 verifier (soroban-sdk 26.1.0,
      `pairing_check`), `init(vk)` + `verify(proof, public_inputs)`. **Compiles to
      wasm + a host test verifies a real snarkjs proof and rejects tampering**
      (`cargo test -p null402-verifier`). snarkjs→contract converter confirmed.
- [x] Host-fn support: BN254 pairing **available** in `soroban-sdk` 26.1.0;
      **Poseidon (CAP-0075) NOT yet exposed** by the SDK's `Crypto`. Pinned 26.1.0,
      target **`wasm32v1-none`** (26 rejects `wasm32-unknown-unknown`).
- [x] **Deployed verifier to Avalanche Fuji** (`CDCYYFSJ…WO32JQJLV`), init'd with the
      circuit vk; verifies a real proof on-chain (CLI + SDK).
- [x] SDK `sorobanVerifier` — encodes the proof, simulate-invokes `verify` over RPC;
      **live testnet test 2/2** (real → true, tampered → false). ScVal: struct as
      scvMap with SYMBOL keys; public inputs as scvVec of bytes.
- [x] `null-402-contracts/pool`: deposit (escrow + commitment record) + on-chain
      nullifier set + operator-gated `settle` (cross-contract Groth16 verify + payout).
      **5 tests pass** (`cargo test`): unit + cross-contract integration with a REAL
      proof + a real SAC token + replay/invalid-proof rejection. (Fully-trustless
      Merkle tree deferred to a Poseidon host fn; the operator computes roots off-chain.)
- [x] Gateway **`VERIFY_MODE=soroban` end-to-end**: real proof → gateway endpoint →
      on-chain verify → 200; gateway-managed roots (`KNOWN_ROOTS`) + nullifiers (KV).
- [x] Full **e2e demo** (`null-402-examples/e2e-demo.mjs`): real proof → gateway → on
      -chain verify, privacy assertion (no secret on the wire), replay/tamper/wrong
      -recipient all rejected. Contracts 10/10, SDK 13/13, gateway 4/4, dashboard clean.
- [ ] (optional) Dashboard real in-browser proving; delete `devVerifier`/`devProver`
      (kept for offline dev). Fully-trustless on-chain pool when CAP-0075 ships.

### Phase 3 — Testnet + hardening
- [ ] Deploy verifier + pool to Avalanche Fuji; flip `VERIFY_MODE=soroban`.
- [ ] Browser proving in the dashboard (snarkjs WASM); real deposit/pay UX.
- [ ] Security pass: replay, root-window, context binding, fee/DoS, malformed proofs.
- [ ] CI per repo (build + test).

### Phase 4 — Ship
- [ ] Publish `null-402` to npm; switch gateway/dashboard off `file:` to the version.
- [ ] `null-402-examples`: node-server, agent-client, next-route.
- [ ] `null-402-docs`: protocol + circuit + contract + threat model.
- [ ] Mainnet deploy checklist; landing page polish.

## Known follow-ups / decisions
- `file:../null-402-sdk` is dev-only; publishing the SDK is the real cross-repo answer.
- `null-402-circuits` is its own repo (separate toolchain). Could fold into contracts.
- Landing is static; convert to Next.js if it needs interactivity.
- Commits are intentionally withheld — owner triggers when ready.
