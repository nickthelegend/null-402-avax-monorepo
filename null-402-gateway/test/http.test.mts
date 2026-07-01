/**
 * In-process HTTP test for the real null-402 gateway (Hono app).
 *
 * Exercises the actual Worker routes via app.fetch() with a mock env (in-memory
 * KV + dev verifier) — no wrangler/workerd needed. Proves the full path:
 *   402 (no payment) → generate proof → 200 (paid) → 402 (replay).
 *
 * Run: npm run test:http
 */

import assert from "node:assert/strict";
import app from "../src/index.js";
import { Null402Client, devProver } from "null-402/client";
import { encodePayment } from "null-402";

const PAYTO = "GTESTGATEWAY_PHASE1";
const SECRET = "phase1-dev-secret";

// Minimal in-memory KV standing in for the Cloudflare KV binding.
const store = new Map<string, string>();
const KV = {
  get: async (k: string) => (store.has(k) ? store.get(k)! : null),
  put: async (k: string, v: string) => void store.set(k, v),
  delete: async (k: string) => void store.delete(k),
};

const env: any = {
  PAYMENT_KV: KV,
  PAYMENT_PAYTO: PAYTO,
  VERIFY_MODE: "dev",
  DEV_SHARED_SECRET: SECRET,
  EVM_CHAIN_ID: "43113",
};

const client = new Null402Client({ prover: devProver({ sharedSecret: SECRET }) });

async function paymentHeader(path: string, requiredAmount: number) {
  const note = await client.deposit(10_000n);
  const bundle = await client.prove({
    note,
    merkleRoot: "0xpoolroot",
    payTo: PAYTO,
    requiredAmount,
    request: { method: "GET", path },
  });
  return encodePayment(bundle);
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("null-402 gateway — in-process HTTP");

await test("GET /health → 200 ok, dev mode", async () => {
  const res = await app.fetch(new Request("http://gw/health"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.verify, "dev-scaffold");
});

await test("GET /v1/price/BTC with no payment → 402 + payment terms", async () => {
  const res = await app.fetch(new Request("http://gw/v1/price/BTC"), env);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.accepts[0].payTo, PAYTO);
  assert.equal(body.accepts[0].maxAmountRequired, "1000");
});

await test("GET /v1/price/BTC with valid proof → 200 + data + privacy header", async () => {
  const header = await paymentHeader("/v1/price/BTC", 1000);
  const res = await app.fetch(
    new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Privacy"), "dev-scaffold");
  assert.equal(res.headers.get("X-Payment-Accepted"), "true");
  const body = await res.json();
  assert.equal(body._privacy, "dev");
  assert.ok(body.price !== undefined && body.symbol === "BTC", "expected price data in body");
});

await test("replay of the same proof → 402", async () => {
  const header = await paymentHeader("/v1/price/BTC", 1000);
  const ok = await app.fetch(
    new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
    env,
  );
  assert.equal(ok.status, 200);
  const replay = await app.fetch(
    new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
    env,
  );
  assert.equal(replay.status, 402);
});

console.log(`\n${passed}/4 checks passed`);
console.log(process.exitCode ? "FAILED" : "ALL PASS");
