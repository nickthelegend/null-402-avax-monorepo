# null-402-circuits

Circom payment circuit for **null-402** — Groth16 over BN254, Poseidon Merkle
tree. Produces the artifacts the SDK proves with and the verifier contract checks.

✅ **Status: building + verifying.** `npm run build` compiles the circuit, runs a
trusted setup, generates a witness, proves, and verifies — end to end.

## The statement

`payment.circom` proves, in zero knowledge:

> "I know the secret to an unspent note that is a leaf in the Pool's Poseidon
> Merkle tree (public root), whose value ≥ `requiredAmount`, and I reveal exactly
> one `nullifier` for it, bound to `payTo` and `contextHash`."

| Signal | Visibility | Meaning |
|---|---|---|
| `noteSecret`, `nullifierSecret`, `noteValue` | **private** | note preimage (only `value ≥ price` is revealed) |
| `pathElements[20]`, `pathIndices[20]` | **private** | Merkle membership path |
| `nullifier` | public `[0]` | `Poseidon(nullifierSecret)` — replay tag |
| `merkleRoot` | public `[1]` | Pool commitment root |
| `payTo` | public `[2]` | recipient binding (field-encoded) |
| `requiredAmount` | public `[3]` | price tier (`noteValue ≥ requiredAmount`) |
| `contextHash` | public `[4]` | request binding (field-encoded) |

**Public signal order is fixed**: `[nullifier, merkleRoot, payTo, requiredAmount,
contextHash]` — it must match `PaymentPublicSignals` in `null-402-sdk` and the
verifier contract's `public_inputs`. Commitment = `Poseidon(noteSecret,
nullifierSecret, noteValue)`.

## Stats (20-level tree)

- Constraints: **11,491** · Wires: 11,516 · Public inputs: 5 · Private inputs: 43
- Trusted setup: Powers of Tau `2^14`, one-time, ships its verifying key.

## Build

```bash
npm install
npm run build      # compile → ptau → groth16 setup → witness → prove → verify
npm run verify     # re-verify the last proof
```

Requires **circom 2.x** (`cargo install --git https://github.com/iden3/circom.git`).
Artifacts land in `build/`:

| Artifact | Consumed by |
|---|---|
| `build/payment_js/payment.wasm` | SDK `groth16Prover` (witness generation) |
| `build/payment.zkey` | SDK `groth16Prover` (proving key) |
| `build/verification_key.json` | SDK `localGroth16Verifier` + the verifier contract |

> The circuit is a fixed relation, so the trusted-setup ceremony is one-time and
> its verifying key is published — no per-app ceremony for SDK consumers.
