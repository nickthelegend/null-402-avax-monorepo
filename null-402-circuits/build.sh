#!/usr/bin/env bash
# Full null-402 circuit pipeline: compile → trusted setup → prove → verify.
# Produces the artifacts the SDK (payment.wasm + payment.zkey) and the verifier
# contract (verification_key.json) consume.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"   # circom 2.x
cd "$(dirname "$0")"

SNARKJS="npx --no-install snarkjs"
POWER=14   # 2^14 = 16384 constraints headroom (circuit is ~5.5k)

mkdir -p build

echo "── [1/6] compile circuit ───────────────────────────────"
circom payment.circom --r1cs --wasm --sym -l node_modules -o build
$SNARKJS r1cs info build/payment.r1cs

echo "── [2/6] powers of tau (phase 1) ───────────────────────"
if [ ! -f build/pot_final.ptau ]; then
  $SNARKJS powersoftau new bn128 $POWER build/pot_0.ptau -v
  $SNARKJS powersoftau contribute build/pot_0.ptau build/pot_1.ptau --name="null-402" -v -e="null402 phase1 entropy"
  $SNARKJS powersoftau prepare phase2 build/pot_1.ptau build/pot_final.ptau -v
fi

echo "── [3/6] groth16 setup (phase 2) ───────────────────────"
$SNARKJS groth16 setup build/payment.r1cs build/pot_final.ptau build/payment_0.zkey
$SNARKJS zkey contribute build/payment_0.zkey build/payment.zkey --name="null-402 phase2" -v -e="null402 phase2 entropy"
$SNARKJS zkey export verificationkey build/payment.zkey build/verification_key.json

echo "── [4/6] generate a valid witness input ────────────────"
node scripts/gen-input.mjs

echo "── [5/6] witness + proof ───────────────────────────────"
node build/payment_js/generate_witness.js build/payment_js/payment.wasm build/input.json build/witness.wtns
$SNARKJS groth16 prove build/payment.zkey build/witness.wtns build/proof.json build/public.json

echo "── [6/6] verify proof ──────────────────────────────────"
$SNARKJS groth16 verify build/verification_key.json build/public.json build/proof.json

echo
echo "public signals (order: nullifier, merkleRoot, payTo, requiredAmount, contextHash):"
cat build/public.json
echo
echo "✅ circuit build + proof verification complete"
