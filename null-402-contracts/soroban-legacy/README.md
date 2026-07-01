# null-402 contracts (Soroban)

Rust/Soroban contracts that make the privacy real and on-chain. Built with
**soroban-sdk 26.1.0** (BN254 pairing host fns, CAP-0074). Target: **`wasm32v1-none`**.

- **`verifier/`** — Groth16 proof verifier. `verify(proof, public_inputs) -> bool`
  via the BN254 multi-pairing host function (`e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) == 1`).
  The verifying key is set once via `init(vk)`. This is the trust anchor.

- **`pool/`** — escrow + settlement. `deposit(from, commitment, amount)` escrows a
  token and records the note commitment; `commitments()` exposes the list for
  off-chain Merkle-tree building; `settle(proof, public_inputs, recipient, amount)`
  is operator-gated and **cross-contract-calls the verifier**, spends the
  nullifier once, and pays the recipient. (No on-chain Poseidon host fn exists yet,
  so the operator computes the Merkle root off-chain from the public commitment
  list — see the trust note in `pool/src/lib.rs`.)

> The pool calls the verifier through a generated `#[contractclient]`, **not** by
> linking the verifier crate — otherwise the verifier's `#[contractimpl]` exports
> leak into the pool wasm and collide with the pool's own `init`. (We hit and
> fixed exactly this.)

## Deployed on testnet

| Contract | id |
|---|---|
| Verifier | [`CDCYYFSJ7QC7RO6L2DHWK6X6IMZ5U5J3IEAKLKTBTBDX45LWO32JQJLV`](https://stellar.expert/explorer/testnet/contract/CDCYYFSJ7QC7RO6L2DHWK6X6IMZ5U5J3IEAKLKTBTBDX45LWO32JQJLV) |
| Pool | [`CCVYSIWUAOZYFVAM6R76DMKDY4Y52SFIPY6CX3HBMUFF5Q4YS32C24XL`](https://stellar.expert/explorer/testnet/contract/CCVYSIWUAOZYFVAM6R76DMKDY4Y52SFIPY6CX3HBMUFF5Q4YS32C24XL) |
| Token (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Real on-chain proof of life:
- Verifier deploy — `d6f109783223f68dbd289b32e7e15ef22ea564fe1b8bff8a2cc841d5100d91a5`
- Verifier `init(vk)` — `75438a9db154121356c2aa33ba4c10f9e8dd423d1bb16518c3f481e169c6514e`
- Real deposit into the pool — `447d0ef8427bf2ad161db726cb093167fa07ec4d686708c35c7bf56a406d3bd4`
- Real settle (on-chain Groth16 verify → payout) — `db18bb8e5dd0dd932d4bcb2609dcfc65148e18b56237bf958a8ffcaca24a91b0`

## Tests — `cargo test` → **10/10**

```
   Running tests/verify.rs
test verifies_real_groth16_proof ... ok          # real snarkjs proof verifies on the host
test rejects_tampered_public_input ... ok
test rejects_wrong_number_of_public_inputs ... ok
test verify_before_init_panics - should panic ... ok
test init_twice_panics - should panic ... ok
test result: ok. 5 passed; 0 failed

   Running tests/pool.rs
test deposit_escrows_funds_and_records_commitment ... ok
test deposits_increment_leaf_index ... ok
test settle_verifies_proof_pays_recipient_and_spends_nullifier ... ok   # cross-contract verify + token payout
test settle_rejects_replay - should panic ... ok
test settle_rejects_invalid_proof - should panic ... ok
test result: ok. 5 passed; 0 failed
```

These are **integration** tests: `pool.settle` makes a real cross-contract call
into the verifier with a real snarkjs proof, escrows/pays a real SAC token, and
enforces single-use nullifiers — all inside the Soroban host.

## Build / test / deploy

```bash
# host test needs a fixture generated from a real proof:
(cd ../null-402-circuits && npm run build && node scripts/export-contract-inputs.mjs)

cargo test                                                            # 10/10
cargo build --target wasm32v1-none --release                         # both wasms

stellar contract deploy --wasm target/wasm32v1-none/release/null402_verifier.wasm --network testnet --source <key>
stellar contract deploy --wasm target/wasm32v1-none/release/null402_pool.wasm     --network testnet --source <key>
# init verifier with the circuit vk; init pool with (token, verifier, operator)
```
