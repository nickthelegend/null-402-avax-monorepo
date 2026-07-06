/**
 * Unit tests for note/commitment + Merkle-witness helpers (client.ts).
 *
 * Uses circomlibjs (Poseidon) only — no snarkjs, no circuit artifacts — so this
 * stays fast and, importantly, exits cleanly (snarkjs is the thing that leaves
 * worker threads open, not circomlibjs).
 *
 * Run: node test/note-commitment.test.mjs
 */

import assert from "node:assert/strict";
import {
  noteCommitment,
  emptyPoolWitness,
  buildPoolWitness,
  poolRoot,
  Null402Client,
  devProver,
} from "../dist/client.js";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

console.log("null-402 SDK — note/commitment + Merkle witness unit tests");

const NOTE = { secret: "123", nullifierSecret: "456", value: 1000n };

await test("noteCommitment: deterministic for the same note", async () => {
  const a = await noteCommitment(NOTE);
  const b = await noteCommitment(NOTE);
  assert.equal(a, b);
  assert.ok(/^\d+$/.test(a), "commitment is a decimal field string");
});

await test("noteCommitment: differs when any field changes", async () => {
  const base = await noteCommitment(NOTE);
  const diffSecret = await noteCommitment({ ...NOTE, secret: "124" });
  const diffNullifier = await noteCommitment({ ...NOTE, nullifierSecret: "457" });
  const diffValue = await noteCommitment({ ...NOTE, value: 1001n });
  assert.notEqual(base, diffSecret);
  assert.notEqual(base, diffNullifier);
  assert.notEqual(base, diffValue);
});

await test("emptyPoolWitness: produces a path of the requested depth", async () => {
  const levels = 8;
  const wit = await emptyPoolWitness(NOTE, levels);
  assert.equal(wit.pathElements.length, levels);
  assert.equal(wit.pathIndices.length, levels);
  assert.ok(wit.pathIndices.every((i) => i === 0), "single leaf is always the left child");
  assert.equal(wit.commitment, await noteCommitment(NOTE));
});

await test("emptyPoolWitness: defaults to 20 levels", async () => {
  const wit = await emptyPoolWitness(NOTE);
  assert.equal(wit.pathElements.length, 20);
});

await test("buildPoolWitness: single-commitment tree root matches emptyPoolWitness's root", async () => {
  const commitment = await noteCommitment(NOTE);
  const levels = 6;
  const empty = await emptyPoolWitness(NOTE, levels);
  const built = await buildPoolWitness([commitment], 0, levels);
  assert.equal(built.merkleRoot, empty.merkleRoot);
});

await test("buildPoolWitness: two-leaf tree gives leaf0 a right sibling = leaf1", async () => {
  const c0 = await noteCommitment(NOTE);
  const c1 = await noteCommitment({ ...NOTE, secret: "999" });
  const levels = 4;
  const wit0 = await buildPoolWitness([c0, c1], 0, levels);
  const wit1 = await buildPoolWitness([c0, c1], 1, levels);

  assert.equal(wit0.pathIndices[0], 0, "leaf 0 is the left child at level 0");
  assert.equal(wit1.pathIndices[0], 1, "leaf 1 is the right child at level 0");
  assert.equal(wit0.pathElements[0], c1, "leaf 0's sibling at level 0 is leaf 1's commitment");
  assert.equal(wit1.pathElements[0], c0, "leaf 1's sibling at level 0 is leaf 0's commitment");
  // Both leaves are members of the SAME tree -> same root.
  assert.equal(wit0.merkleRoot, wit1.merkleRoot);
});

await test("buildPoolWitness: empty commitment list still returns a deterministic zero-tree root", async () => {
  const levels = 5;
  const a = await buildPoolWitness([], 0, levels);
  const b = await buildPoolWitness([], 0, levels);
  assert.equal(a.merkleRoot, b.merkleRoot);
});

await test("poolRoot: matches buildPoolWitness's root for leaf 0", async () => {
  const c0 = await noteCommitment(NOTE);
  const c1 = await noteCommitment({ ...NOTE, secret: "999" });
  const levels = 4;
  const root = await poolRoot([c0, c1], levels);
  const wit = await buildPoolWitness([c0, c1], 0, levels);
  assert.equal(root, wit.merkleRoot);
});

// ── Null402Client.deposit / prove (dev prover, no chain) ───────────────────

await test("Null402Client.deposit: mints a note with the requested value and fresh secrets", async () => {
  const client = new Null402Client({ prover: devProver({ sharedSecret: "s" }) });
  const n1 = await client.deposit(500n);
  const n2 = await client.deposit(500n);
  assert.equal(n1.value, 500n);
  assert.notEqual(n1.secret, n2.secret, "secrets must be randomized per note");
  assert.notEqual(n1.nullifierSecret, n2.nullifierSecret);
});

await test("Null402Client.prove: contextHash binds method+path+amount+payTo (dev prover)", async () => {
  const client = new Null402Client({ prover: devProver({ sharedSecret: "s" }) });
  const note = await client.deposit(1000n);
  const bundleA = await client.prove({
    note, merkleRoot: "root", payTo: "0xGW", requiredAmount: 100,
    request: { method: "GET", path: "/a" },
  });
  const bundleB = await client.prove({
    note, merkleRoot: "root", payTo: "0xGW", requiredAmount: 100,
    request: { method: "GET", path: "/b" },
  });
  assert.notEqual(bundleA.publicSignals.contextHash, bundleB.publicSignals.contextHash);
});

console.log(`\n${passed} checks passed`);
console.log(process.exitCode ? "FAILED" : "ALL PASS");
