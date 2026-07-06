/**
 * In-process HTTP test for the gateway's REAL on-chain verify path
 * (VERIFY_MODE="evm" → evmVerifier → eth_call), stubbed with a local JSON-RPC
 * server instead of live Avalanche Fuji.
 *
 * The gateway's EVM_RPC_URL is just a config string (see src/types.ts), so
 * pointing it at http://127.0.0.1:<local-port> exercises the exact same
 * evmVerifier code path (viem createPublicClient + readContract + eth_call)
 * deterministically and fully offline — no live network, no real keys.
 *
 * This does NOT re-test Groth16 pairing math (that's covered by the real
 * on-chain proof fixture in null-402-contracts/test/Null402.t.sol via Foundry,
 * and by null-402-sdk/test/real-proof.test.mjs against snarkjs). It proves the
 * gateway correctly wires eth_call results into its 402/200 decision and that
 * a `false` verifyProof result is rejected exactly like a `true` one is
 * accepted, using the same code path production traffic takes.
 *
 * Run: npm run test:http-evm
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import app from "../src/index.js";
import { Null402Client, groth16Prover } from "null-402/client";
import { encodePayment } from "null-402";

// ── Local JSON-RPC stub standing in for Fuji ────────────────────────────────
//
// Responds to eth_call for verifyProof with a canned ABI-encoded bool. Every
// other method (eth_chainId, eth_blockNumber, etc., which viem's public client
// may probe) gets an inert-but-valid response so client setup never blocks on
// real network I/O.

const ABI_TRUE = "0x" + "0".repeat(63) + "1";
const ABI_FALSE = "0x" + "0".repeat(64);

function startStubRpc(shouldVerify: () => boolean) {
  let lastCallData: string | undefined;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body);
      const respond = (result: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
      };
      switch (payload.method) {
        case "eth_chainId":
          return respond("0xa869"); // 43113
        case "eth_call":
          lastCallData = payload.params?.[0]?.data;
          return respond(shouldVerify() ? ABI_TRUE : ABI_FALSE);
        case "eth_blockNumber":
          return respond("0x1");
        case "eth_getBlockByNumber":
          return respond({ number: "0x1", timestamp: "0x0" });
        case "eth_gasPrice":
          return respond("0x1");
        case "eth_estimateGas":
          return respond("0x5208");
        default:
          return respond(null);
      }
    });
  });
  return new Promise<{ url: string; close: () => Promise<void>; lastCallData: () => string | undefined }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise((r) => server.close(() => r())),
          lastCallData: () => lastCallData,
        });
      });
    },
  );
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${(err as Error).stack || (err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("null-402 gateway — in-process HTTP (VERIFY_MODE=evm, stubbed RPC)");

const store = new Map<string, string>();
const KV = {
  get: async (k: string) => (store.has(k) ? store.get(k)! : null),
  put: async (k: string, v: string) => void store.set(k, v),
  delete: async (k: string) => void store.delete(k),
};

// A mock prover: the *gateway's* verifier (stubbed eth_call) is what decides
// accept/reject in evm mode, so the actual Groth16 proof contents don't need
// to be real for this test's purpose. But evmVerifier DOES BigInt-parse every
// public signal before making the eth_call (it formats them as calldata), so
// every signal — including the nullifier — must be a decimal field-element
// string, never a placeholder like "nf-123" or "0xpoolroot".
let nullifierCounter = 0;
const client = new Null402Client({
  prover: {
    mode: "groth16",
    async prove(input) {
      nullifierCounter += 1;
      return {
        proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: {
          nullifier: String(1_000_000 + nullifierCounter),
          merkleRoot: input.merkleRoot,
          payTo: input.payTo,
          requiredAmount: input.requiredAmount,
          contextHash: input.contextHash,
        },
      };
    },
  },
});

// evmVerifier (unlike the dev verifier) BigInt-parses every public signal
// before the eth_call, so the merkle root fixture must be a real field element
// (decimal string) — not a placeholder like "0xpoolroot".
const FIXTURE_ROOT = "12345678901234567890";

async function paymentHeader(path: string, requiredAmount: number, payTo: string, merkleRoot = FIXTURE_ROOT) {
  const note = await client.deposit(10_000n);
  const bundle = await client.prove({
    note,
    merkleRoot,
    payTo,
    requiredAmount,
    request: { method: "GET", path },
  });
  return encodePayment(bundle);
}

await test("VERIFY_MODE=evm + eth_call returns true → 200 (real gateway code path)", async () => {
  const rpc = await startStubRpc(() => true);
  try {
    const env: any = {
      PAYMENT_KV: KV,
      PAYMENT_PAYTO: "0xGATEWAY",
      VERIFY_MODE: "evm",
      EVM_RPC_URL: rpc.url,
      EVM_CHAIN_ID: "43113",
      VERIFIER_CONTRACT_ID: "0x0000000000000000000000000000000000000001",
      KNOWN_ROOTS: "",
    };
    const header = await paymentHeader("/v1/price/BTC", 1000, "0xGATEWAY");
    const res = await app.fetch(
      new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Privacy"), "zk-groth16");
    const body = await res.json();
    assert.equal(body._privacy, "evm");
    assert.ok(rpc.lastCallData(), "gateway actually issued an eth_call");
  } finally {
    await rpc.close();
  }
});

await test("VERIFY_MODE=evm + eth_call returns false → 402 payment-rejected", async () => {
  const rpc = await startStubRpc(() => false);
  try {
    const env: any = {
      PAYMENT_KV: KV,
      PAYMENT_PAYTO: "0xGATEWAY2",
      VERIFY_MODE: "evm",
      EVM_RPC_URL: rpc.url,
      EVM_CHAIN_ID: "43113",
      VERIFIER_CONTRACT_ID: "0x0000000000000000000000000000000000000001",
      KNOWN_ROOTS: "",
    };
    const header = await paymentHeader("/v1/price/BTC", 1000, "0xGATEWAY2");
    const res = await app.fetch(
      new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
      env,
    );
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.error, "payment-rejected");
    assert.equal(body.reason, "invalid-proof");
  } finally {
    await rpc.close();
  }
});

await test("VERIFY_MODE=evm + KNOWN_ROOTS set rejects an unlisted root as unknown-root", async () => {
  const rpc = await startStubRpc(() => true);
  try {
    const env: any = {
      PAYMENT_KV: KV,
      PAYMENT_PAYTO: "0xGATEWAY3",
      VERIFY_MODE: "evm",
      EVM_RPC_URL: rpc.url,
      EVM_CHAIN_ID: "43113",
      VERIFIER_CONTRACT_ID: "0x0000000000000000000000000000000000000001",
      KNOWN_ROOTS: "0xsomeotherroot,0xanotherone",
    };
    const header = await paymentHeader("/v1/price/BTC", 1000, "0xGATEWAY3");
    const res = await app.fetch(
      new Request("http://gw/v1/price/BTC", { headers: { "X-PAYMENT": header } }),
      env,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.reason, "unknown-root");
  } finally {
    await rpc.close();
  }
});

console.log(`\n${passed}/3 checks passed`);
console.log(process.exitCode ? "FAILED" : "ALL PASS");
