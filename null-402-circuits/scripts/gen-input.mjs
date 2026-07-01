/**
 * Build a valid witness input for payment.circom — a real note + Poseidon Merkle
 * membership proof — so `snarkjs groth16 prove` produces a genuinely verifiable
 * proof. Mirrors exactly what the SDK's groth16Prover will compute at runtime.
 *
 * Writes build/input.json.
 */

import { buildPoseidon } from "circomlibjs";
import { writeFileSync, mkdirSync } from "node:fs";

const LEVELS = 20;

const poseidonHasher = await buildPoseidon();
const F = poseidonHasher.F;
const P = (arr) => F.toObject(poseidonHasher(arr.map((x) => F.e(x)))); // -> BigInt

// ── A note (kept secret in real life; fixed here for a reproducible sample) ──
const noteSecret = 12345n;
const nullifierSecret = 67890n;
const noteValue = 5000n;

const commitment = P([noteSecret, nullifierSecret, noteValue]);
const nullifier = P([nullifierSecret]);

// ── Empty-subtree zero hashes (leaf sits at index 0; siblings are all zeros) ──
const zeros = [0n];
for (let i = 1; i < LEVELS; i++) zeros[i] = P([zeros[i - 1], zeros[i - 1]]);

// Path for index 0: current node is the left child at every level.
const pathElements = [];
const pathIndices = [];
let cur = commitment;
for (let i = 0; i < LEVELS; i++) {
  pathElements.push(zeros[i]);
  pathIndices.push(0);
  cur = P([cur, zeros[i]]); // hash(left=cur, right=zero)
}
const merkleRoot = cur;

// ── Public request bindings (arbitrary field elements for the sample) ────────
const payTo = 111111111111111n;     // SDK maps a Stellar address -> field
const requiredAmount = 1000n;        // noteValue (5000) >= 1000
const contextHash = 222222222222222n; // SDK = Poseidon(method,path,price,payTo,nonce)

const input = {
  noteSecret: noteSecret.toString(),
  nullifierSecret: nullifierSecret.toString(),
  noteValue: noteValue.toString(),
  pathElements: pathElements.map((x) => x.toString()),
  pathIndices: pathIndices.map((x) => x.toString()),
  nullifier: nullifier.toString(),
  merkleRoot: merkleRoot.toString(),
  payTo: payTo.toString(),
  requiredAmount: requiredAmount.toString(),
  contextHash: contextHash.toString(),
};

mkdirSync("build", { recursive: true });
writeFileSync("build/input.json", JSON.stringify(input, null, 2));
console.log("wrote build/input.json");
console.log("  commitment :", commitment.toString());
console.log("  nullifier  :", nullifier.toString());
console.log("  merkleRoot :", merkleRoot.toString());
