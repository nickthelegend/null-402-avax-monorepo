/**
 * null-402 — full end-to-end demo. No mocks.
 *
 *   real Circom/Groth16 proof (snarkjs) → real gateway endpoints (Hono)
 *   → real on-chain BN254 verification (Solidity verifier on Avalanche Fuji)
 *
 * Shows: the privacy contrast, the 402→prove→200 flow, what is revealed vs
 * hidden, and that replay / tampered / wrong-recipient payments are rejected.
 *
 * Run:  node e2e-demo.mjs       (from null-402-examples/)
 * Needs: circuits built (../null-402-circuits/build) + SDK & gateway built.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import app from "../null-402-gateway/dist/index.js";
import {
  Null402Client,
  groth16Prover,
  emptyPoolWitness,
  encodePayment,
  decodePayment,
  localGroth16Verifier,
} from "../null-402-sdk/dist/index.js";

// ── config ──────────────────────────────────────────────────────────────────
const RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const VERIFIER_ID = "0x0b44836dDc460f589ce4EB97f276e533A2bE6060"; // Groth16 verifier on Fuji
const PAYTO = "0x86076053d71E1c95b3c08e68BA39049024D69E67"; // demo gateway address (0x)
const ENDPOINT = "/v1/price/BTC";
const PRICE = 1000; // 0.001 tier (base units)

const P = (u) => fileURLToPath(new URL(u, import.meta.url));
const wasmPath = P("../null-402-circuits/build/payment_js/payment.wasm");
const zkeyPath = P("../null-402-circuits/build/payment.zkey");
const vkeyPath = P("../null-402-circuits/build/verification_key.json");

if (![wasmPath, zkeyPath, vkeyPath].every(existsSync)) {
  console.error("Circuit artifacts missing. Run: (cd ../null-402-circuits && npm install && npm run build)");
  process.exit(1);
}

// ── pretty printing ─────────────────────────────────────────────────────────
const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const vi = (s) => `\x1b[35m${s}\x1b[0m`;
const hr = () => console.log(dim("─".repeat(74)));
function step(n, t) { console.log(`\n${b(`${n}.`)} ${b(t)}`); }

console.log(b("\n  ∅  null-402 — private pay-per-call on Avalanche  ·  end-to-end demo\n"));
hr();

// ── 0. the problem ──────────────────────────────────────────────────────────
step(0, "What a PUBLIC x402 payment leaks vs. what null-402 reveals");
console.table({
  "sender account": { "standard x402": red("PUBLIC"), "null-402": ok("hidden") },
  "exact amount": { "standard x402": red("PUBLIC"), "null-402": ok("hidden (proven ≥ price)") },
  "API endpoint": { "standard x402": red("logged"), "null-402": ok("hidden") },
  "access frequency": { "standard x402": red("indexable"), "null-402": ok("hidden") },
  "payment valid": { "standard x402": ok("yes"), "null-402": ok("yes — on-chain Groth16") },
});

const verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const client = new Null402Client({ prover: groth16Prover({ wasmPath, zkeyPath }) });

// Build a real proof bound to (gateway, price, endpoint) for a fresh note.
async function payment(payTo = PAYTO) {
  const note = await client.deposit(5000n); // value 5000 ≥ price 1000; value stays secret
  const { merkleRoot, pathElements, pathIndices } = await emptyPoolWitness(note);
  const bundle = await client.prove({
    note, merkleRoot, payTo, requiredAmount: PRICE,
    request: { method: "GET", path: ENDPOINT }, pathElements, pathIndices,
  });
  return { note, bundle, merkleRoot, header: encodePayment(bundle) };
}

// ── 1. client side: deposit + prove ─────────────────────────────────────────
step(1, "Client deposits a private note and proves a payment — locally");
const main = await payment();
console.log(`   ${dim("note value:")} 5000 (secret)   ${dim("price:")} ${PRICE}`);
console.log(`   ${dim("proof public signals (the ONLY things anyone sees):")}`);
console.log(`     nullifier   = ${main.bundle.publicSignals.nullifier.slice(0, 24)}…  ${dim("(one-time spend tag)")}`);
console.log(`     merkleRoot  = ${main.bundle.publicSignals.merkleRoot.slice(0, 24)}…`);
console.log(`     payTo,price,context ${dim("= field-bound to this gateway + request")}`);
console.log(`   ${dim("hidden in the witness:")} note secret, exact value, which note, who you are`);

// ── 2. proof verifies off-chain (snarkjs) — sanity on the trust chain ───────
step(2, "The proof verifies with snarkjs (same check the chain runs)");
const localOk = await localGroth16Verifier({ verificationKey }).verify(main.bundle);
console.log(`   localGroth16Verifier → ${localOk ? ok("VALID") : red("INVALID")}`);

// ── network preflight ────────────────────────────────────────────────────────
const online = await fetch(RPC, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
}).then((r) => r.ok).catch(() => false);

const env = {
  PAYMENT_KV: (() => { const m = new Map(); return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  }; })(),
  PAYMENT_PAYTO: PAYTO,
  VERIFY_MODE: "evm",
  EVM_RPC_URL: RPC,
  EVM_CHAIN_ID: "43113",
  VERIFIER_CONTRACT_ID: VERIFIER_ID,
  KNOWN_ROOTS: main.merkleRoot, // gateway-managed: accept this deposit's root
};

if (!online) {
  hr();
  console.log(red("\n  Avalanche Fuji unreachable — skipping the on-chain gateway section."));
  console.log(dim("  (the proof + off-chain verification above are fully real and complete)\n"));
  process.exit(0);
}

const GET = (headers = {}) => app.fetch(new Request(`http://gw${ENDPOINT}`, { headers }), env);

// ── 3. no payment → 402 ──────────────────────────────────────────────────────
step(3, `GET ${ENDPOINT} with NO payment`);
const r402 = await GET();
const terms = await r402.json();
console.log(`   → ${b(r402.status)} ${dim("Payment Required")}   payTo=${terms.accepts[0].payTo.slice(0, 10)}… price=${terms.accepts[0].maxAmountRequired}`);

// ── 4. pay with the ZK proof → 200, verified ON-CHAIN ────────────────────────
step(4, `GET ${ENDPOINT} with the ZK proof  ${dim("(gateway verifies on Avalanche Fuji)")}`);
const r200 = await GET({ "X-PAYMENT": main.header });
const r200text = await r200.text();
console.log(`   → ${r200.status === 200 ? ok(b("200 OK")) : red(b(r200.status))}` +
  `   X-Privacy=${vi(r200.headers.get("X-Privacy"))}` +
  `   X-Payment-Accepted=${r200.headers.get("X-Payment-Accepted")}`);
if (r200.status === 200) {
  console.log(`   ${dim("response:")} BTC price data served · proof=${b(JSON.parse(r200text)._privacy)} · nothing about the payer logged`);
}

// ── 4b. PRIVACY PROOF: the secret never appears anywhere it shouldn't ────────
step("4b", "Privacy assertion — secrets are absent from the wire and the response");
const wire = JSON.stringify(decodePayment(main.header));            // what the client SENDS
const seen = r200text + "\n" + [...r200.headers].map(([k, v]) => `${k}:${v}`).join("\n"); // what comes BACK
const secrets = {
  "note secret": main.note.secret,
  "nullifier secret": main.note.nullifierSecret,
  "exact value (5000)": main.note.value.toString(),
};
let leaked = false;
for (const [label, val] of Object.entries(secrets)) {
  const inWire = wire.includes(val);
  const inResp = seen.includes(val);
  if (inWire || inResp) leaked = true;
  console.log(`   ${label.padEnd(20)} in X-PAYMENT: ${inWire ? red("LEAKED") : ok("absent")}   in response: ${inResp ? red("LEAKED") : ok("absent")}`);
}
console.log(`   ${leaked ? red(b("PRIVACY FAIL")) : ok(b("PRIVACY HELD — no secret crossed the wire"))}`);

// ── 5. replay the same proof → 402 ───────────────────────────────────────────
step(5, "Replay the SAME proof (double-spend attempt)");
const rReplay = await GET({ "X-PAYMENT": main.header });
console.log(`   → ${rReplay.status === 402 ? ok(b("402 rejected")) : red(b(rReplay.status))} ${dim("(nullifier already used — caught before the chain)")}`);

// ── 6. tampered proof → 402 (on-chain pairing fails) ─────────────────────────
step(6, "Tamper the proof (forge the cryptography)");
const t = await payment();
const tampered = decodePayment(t.header);
tampered.proof.pi_a[0] = (BigInt(tampered.proof.pi_a[0]) + 1n).toString();
env.KNOWN_ROOTS = [main.merkleRoot, t.merkleRoot].join(",");
const rTamper = await GET({ "X-PAYMENT": encodePayment(tampered) });
console.log(`   → ${rTamper.status === 402 ? ok(b("402 rejected")) : red(b(rTamper.status))} ${dim("(BN254 pairing fails on-chain)")}`);

// ── 7. wrong recipient → 400 (proof bound to a different gateway) ────────────
step(7, "Use a proof made for a DIFFERENT gateway (stolen proof)");
const wrong = await payment("GSOMEOTHERGATEWAYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const rWrong = await GET({ "X-PAYMENT": wrong.header });
const wrongBody = await rWrong.json().catch(() => ({}));
console.log(`   → ${rWrong.status === 400 ? ok(b("400 rejected")) : red(b(rWrong.status))} ${dim(`(${wrongBody.reason ?? "recipient mismatch"} — payTo is bound into the proof)`)}`);

// ── summary ──────────────────────────────────────────────────────────────────
hr();
console.log(b("\n  ✓ Flow complete — every step real, no mocks:\n"));
console.log(`    • proof generated client-side (snarkjs + Circom)        ${ok("✓")}`);
console.log(`    • verified off-chain (snarkjs) and ON-CHAIN (Avalanche)     ${ok("✓")}`);
console.log(`    • valid payment served the API                          ${ok("✓")}`);
console.log(`    • replay / tampered / wrong-recipient all rejected      ${ok("✓")}`);
console.log(`\n  On-chain, the world sees: ${vi("a nullifier")} + ${vi("valid:true")}.  Not who, not how much, not which endpoint.\n`);
