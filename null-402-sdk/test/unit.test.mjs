/**
 * Unit tests for null-402 SDK pure helpers: BN254 byte encoding, proof/context
 * encoding, config resolution, and Solidity calldata formatting.
 *
 * No chain, no circuit, no snarkjs — fast and fully deterministic. Exits clean.
 *
 * Run: node test/unit.test.mjs
 */

import assert from "node:assert/strict";
import { fieldToBytes, g1ToBytes, g2ToBytes } from "../dist/encoding.js";
import {
  encodePayment,
  decodePayment,
  contextPreimage,
  toField,
  addressToField,
  hashContext,
  BN254_FR,
} from "../dist/proof.js";
import { toSolidityProof, solidityPublicSignals, POOL_ABI } from "../dist/evm.js";
import { publicSignalArray } from "../dist/verifier.js";

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

console.log("null-402 SDK — unit tests (pure helpers)");

// ── encoding.ts: fieldToBytes ────────────────────────────────────────────────

await test("fieldToBytes: zero encodes to 32 zero bytes", () => {
  const b = fieldToBytes("0");
  assert.equal(b.length, 32);
  assert.ok(b.every((x) => x === 0));
});

await test("fieldToBytes: small value is big-endian right-aligned", () => {
  const b = fieldToBytes("1");
  assert.equal(b[31], 1);
  for (let i = 0; i < 31; i++) assert.equal(b[i], 0);
});

await test("fieldToBytes: 256 rolls into the second-to-last byte", () => {
  const b = fieldToBytes("256");
  assert.equal(b[30], 1);
  assert.equal(b[31], 0);
});

await test("fieldToBytes: round-trips the BN254 scalar field modulus - 1", () => {
  const dec = (BN254_FR - 1n).toString();
  const b = fieldToBytes(dec);
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  assert.equal(n.toString(), dec);
});

// ── encoding.ts: g1ToBytes / g2ToBytes ───────────────────────────────────────

await test("g1ToBytes: packs x then y into 64 bytes", () => {
  const b = g1ToBytes(["1", "2"]);
  assert.equal(b.length, 64);
  assert.equal(b[31], 1); // x
  assert.equal(b[63], 2); // y
});

await test("g2ToBytes: swaps c0/c1 order (imaginary first) into 128 bytes", () => {
  // x = [c0=1, c1=2], y = [c0=3, c1=4]
  const b = g2ToBytes([
    ["1", "2"],
    ["3", "4"],
  ]);
  assert.equal(b.length, 128);
  assert.equal(b[31], 2); // x.c1 first
  assert.equal(b[63], 1); // x.c0 second
  assert.equal(b[95], 4); // y.c1 first
  assert.equal(b[127], 3); // y.c0 second
});

// ── proof.ts: contextPreimage / toField / hashContext / addressToField ──────

await test("contextPreimage: deterministic newline-joined, uppercased method", () => {
  const p = contextPreimage({
    method: "get",
    path: "/v1/price/BTC",
    requiredAmount: 1000,
    payTo: "0xGATEWAY",
  });
  assert.equal(p, "GET\n/v1/price/BTC\n1000\n0xGATEWAY\n");
});

await test("contextPreimage: includes nonce when provided", () => {
  const p = contextPreimage({
    method: "POST",
    path: "/x",
    requiredAmount: "5",
    payTo: "0xA",
    nonce: "abc",
  });
  assert.equal(p, "POST\n/x\n5\n0xA\nabc");
});

await test("toField: deterministic and within the BN254 scalar field", async () => {
  const a = await toField("hello");
  const b = await toField("hello");
  assert.equal(a, b);
  assert.ok(BigInt(a) < BN254_FR);
  assert.ok(BigInt(a) >= 0n);
});

await test("toField: different inputs produce different outputs", async () => {
  const a = await toField("hello");
  const b = await toField("hellp");
  assert.notEqual(a, b);
});

await test("addressToField: namespaces the input so it differs from a raw toField", async () => {
  const addr = "0xDEADBEEF";
  const viaAddress = await addressToField(addr);
  const viaRaw = await toField(addr);
  assert.notEqual(viaAddress, viaRaw);
  assert.equal(viaAddress, await toField("null402:payTo:" + addr));
});

await test("hashContext: equals toField of the same preimage", async () => {
  const preimage = contextPreimage({ method: "GET", path: "/p", requiredAmount: 1, payTo: "0xA" });
  assert.equal(await hashContext(preimage), await toField(preimage));
});

// ── proof.ts: encodePayment / decodePayment round-trip ──────────────────────

const sampleBundle = {
  proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
  publicSignals: {
    nullifier: "111",
    merkleRoot: "222",
    payTo: "333",
    requiredAmount: "1000",
    contextHash: "444",
  },
};

await test("encodePayment/decodePayment: round-trips a bundle", () => {
  const header = encodePayment(sampleBundle);
  assert.equal(typeof header, "string");
  // base64url must not contain +, /, or = padding
  assert.ok(!/[+/=]/.test(header));
  const decoded = decodePayment(header);
  assert.deepEqual(decoded, sampleBundle);
});

await test("decodePayment: returns null for missing/empty header", () => {
  assert.equal(decodePayment(null), null);
  assert.equal(decodePayment(undefined), null);
  assert.equal(decodePayment(""), null);
  assert.equal(decodePayment("   "), null);
});

await test("decodePayment: returns null for malformed base64", () => {
  assert.equal(decodePayment("!!!not-base64!!!"), null);
});

await test("decodePayment: returns null for valid base64 but non-JSON", () => {
  const b64 = Buffer.from("not json at all", "utf8").toString("base64url");
  assert.equal(decodePayment(b64), null);
});

await test("decodePayment: returns null when publicSignals fields are missing", () => {
  const incomplete = { proof: {}, publicSignals: { nullifier: "1", merkleRoot: "2" } };
  const header = Buffer.from(JSON.stringify(incomplete), "utf8")
    .toString("base64url");
  assert.equal(decodePayment(header), null);
});

await test("decodePayment: returns null when publicSignals is absent entirely", () => {
  const header = Buffer.from(JSON.stringify({ proof: {} }), "utf8").toString("base64url");
  assert.equal(decodePayment(header), null);
});

// ── verifier.ts: publicSignalArray ordering ─────────────────────────────────

await test("publicSignalArray: fixed circuit order [nullifier, root, payTo, amount, ctx]", () => {
  const arr = publicSignalArray(sampleBundle);
  assert.deepEqual(arr, ["111", "222", "333", "1000", "444"]);
});

// ── evm.ts: toSolidityProof (G2 coordinate swap) ────────────────────────────

await test("toSolidityProof: converts pi_a/pi_c to bigint pairs as-is", () => {
  const out = toSolidityProof(sampleBundle.proof);
  assert.deepEqual(out.a, [1n, 2n]);
  assert.deepEqual(out.c, [7n, 8n]);
});

await test("toSolidityProof: swaps each pi_b inner pair (snarkjs G2 solidity export convention)", () => {
  const out = toSolidityProof(sampleBundle.proof);
  // pi_b = [[3,4],[5,6]] -> b[0] = [4,3], b[1] = [6,5]
  assert.deepEqual(out.b, [
    [4n, 3n],
    [6n, 5n],
  ]);
});

await test("solidityPublicSignals: maps the 5 signals to a bigint tuple in order", () => {
  const out = solidityPublicSignals(sampleBundle);
  assert.deepEqual(out, [111n, 222n, 333n, 1000n, 444n]);
});

await test("solidityPublicSignals: throws on non-numeric signal (BigInt guard)", () => {
  const bad = {
    ...sampleBundle,
    publicSignals: { ...sampleBundle.publicSignals, nullifier: "not-a-number" },
  };
  assert.throws(() => solidityPublicSignals(bad));
});

// ── evm.ts: POOL_ABI sanity (config/ABI resolution) ─────────────────────────

await test("POOL_ABI: exposes the expected settle() signature shape", () => {
  const settle = POOL_ABI.find((f) => f.type === "function" && f.name === "settle");
  assert.ok(settle, "settle entry present");
  assert.equal(settle.inputs.length, 6);
  assert.equal(settle.inputs[3].type, "uint256[5]");
  assert.equal(settle.inputs[4].name, "recipient");
});

await test("POOL_ABI: exposes the Deposit event with indexed index/from", () => {
  const dep = POOL_ABI.find((f) => f.type === "event" && f.name === "Deposit");
  assert.ok(dep);
  const indexed = dep.inputs.filter((i) => i.indexed).map((i) => i.name);
  assert.deepEqual(indexed, ["index", "from"]);
});

console.log(`\n${passed} checks passed`);
console.log(process.exitCode ? "FAILED" : "ALL PASS");
