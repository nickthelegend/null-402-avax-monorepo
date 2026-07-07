/**
 * Unit tests for null-402-mcp's tool handlers (createWallet / walletStatus /
 * deposit / pay) with every chain-facing dependency MOCKED via createHandlers().
 *
 * No live Fuji RPC, no real transactions, no wallet file outside a temp dir.
 * viem clients, the SDK's poolDeposit/poolCommitments, the Null402Client prover,
 * and fetch are all injected fakes.
 *
 * Run: node test/lib.test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers, DENOM, config as prodConfig } from "../src/lib.mjs";

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

console.log("null-402-mcp — lib.mjs unit tests (mocked chain clients)");

// ── test fixtures ────────────────────────────────────────────────────────────

function tempWalletPath() {
  const dir = mkdtempSync(join(tmpdir(), "null402-mcp-test-"));
  return join(dir, "wallet.json");
}

function fakeConfig(overrides = {}) {
  return {
    rpcUrl: "http://fake-rpc.invalid",
    chainId: 43113,
    poolContractId: "0xPOOL",
    verifierContractId: "0xVERIFIER",
    token: "0xTOKEN",
    funderKey: "",
    wasmPath: "/nonexistent/payment.wasm",
    zkeyPath: "/nonexistent/payment.zkey",
    walletPath: tempWalletPath(),
    ...overrides,
  };
}

/** A fake viem PublicClient — only the methods lib.mjs actually calls. */
function fakePublicClient(overrides = {}) {
  return {
    getBalance: async () => 1_500_000_000_000_000_000n, // 1.5 AVAX
    readContract: async () => 42_000_000n, // 4.2 nUSD @ 7 decimals
    waitForTransactionReceipt: async ({ hash }) => ({ status: "success", transactionHash: hash }),
    ...overrides,
  };
}

/** A fake viem WalletClient factory: records calls, returns canned tx hashes. */
function fakeWalletFor(recorder = []) {
  return (privateKey) => ({
    account: { address: "0xFUNDER" },
    sendTransaction: async (args) => {
      recorder.push({ type: "sendTransaction", privateKey, args });
      return "0xFUNDTXHASH";
    },
    writeContract: async (args) => {
      recorder.push({ type: "writeContract", privateKey, args });
      return "0xMINTTXHASH";
    },
  });
}

/** A fake Null402Client — no real proving/circuits involved. */
function fakeClient(overrides = {}) {
  return {
    deposit: async (value) => ({ secret: "111", nullifierSecret: "222", value }),
    prove: async (args) => ({
      proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
      publicSignals: {
        nullifier: "999999999999999999999999999999",
        merkleRoot: args.merkleRoot,
        payTo: "111",
        requiredAmount: String(args.requiredAmount),
        contextHash: "222",
      },
    }),
    ...overrides,
  };
}

function makeHandlers(overrides = {}) {
  const cfg = overrides.config ?? fakeConfig();
  return {
    cfg,
    handlers: createHandlers({
      config: cfg,
      publicClient: fakePublicClient(),
      walletFor: fakeWalletFor(),
      client: fakeClient(),
      poolDeposit: async () => ({ hash: "0xDEPOSITTX", leafIndex: 0 }),
      poolCommitments: async () => [],
      fetch: async () => new Response("not used", { status: 200 }),
      ...overrides,
    }),
  };
}

// ── createWallet ─────────────────────────────────────────────────────────────

await test("createWallet: generates and persists a wallet to the injected temp path", async () => {
  const { cfg, handlers } = makeHandlers();
  const out = await handlers.createWallet();
  assert.match(out, /Created an Avalanche Fuji wallet/);
  assert.match(out, /0x[0-9a-fA-F]{40}/);

  assert.ok(existsSync(cfg.walletPath), "wallet file must exist at the injected path");
  const w = JSON.parse(readFileSync(cfg.walletPath, "utf8"));
  assert.ok(w.privateKey.startsWith("0x"));
  assert.ok(w.address.startsWith("0x"));
  assert.deepEqual(w.notes, []);
});

await test("createWallet: without a funderKey, tells the caller to fund manually (no sendTransaction)", async () => {
  const recorder = [];
  const { handlers } = makeHandlers({ walletFor: fakeWalletFor(recorder) });
  const out = await handlers.createWallet();
  assert.match(out, /set NULL402_FUNDER_KEY or send Fuji AVAX/);
  assert.equal(recorder.length, 0);
});

await test("createWallet: with a funderKey, funds the new wallet via the injected wallet client", async () => {
  const recorder = [];
  const cfg = fakeConfig({ funderKey: "0xFUNDERKEY" });
  const { handlers } = makeHandlers({ config: cfg, walletFor: fakeWalletFor(recorder) });
  const out = await handlers.createWallet();
  assert.match(out, /funded 0\.05 AVAX for gas/);
  assert.equal(recorder.length, 1);
  assert.equal(recorder[0].type, "sendTransaction");
  assert.equal(recorder[0].args.value, 50_000_000_000_000_000n); // 0.05 AVAX in wei
});

await test("createWallet: funder failure is reported but wallet is still created", async () => {
  const cfg = fakeConfig({ funderKey: "0xFUNDERKEY" });
  const failingWalletFor = () => ({
    sendTransaction: async () => { throw new Error("insufficient funds"); },
  });
  const { handlers } = makeHandlers({ config: cfg, walletFor: failingWalletFor });
  const out = await handlers.createWallet();
  assert.match(out, /auto-fund failed/);
  assert.ok(existsSync(cfg.walletPath));
});

await test("createWallet: idempotent — returns the existing wallet on a second call", async () => {
  const { handlers } = makeHandlers();
  const first = await handlers.createWallet();
  const second = await handlers.createWallet();
  assert.match(second, /Wallet already exists/);
  const addr1 = first.match(/0x[0-9a-fA-F]{40}/)[0];
  const addr2 = second.match(/0x[0-9a-fA-F]{40}/)[0];
  assert.equal(addr1, addr2);
});

// ── walletStatus ─────────────────────────────────────────────────────────────

await test("walletStatus: no wallet yet reports so, without touching the network", async () => {
  const { handlers } = makeHandlers();
  const out = await handlers.walletStatus();
  assert.equal(out, "No wallet yet — call create_wallet.");
});

await test("walletStatus: reads balances via the mocked publicClient", async () => {
  const { handlers } = makeHandlers({
    publicClient: fakePublicClient({
      getBalance: async () => 2_000_000_000_000_000_000n, // 2 AVAX
      readContract: async () => 10_000_000n, // 1.0 nUSD
    }),
  });
  await handlers.createWallet();
  const out = await handlers.walletStatus();
  assert.match(out, /AVAX \(gas\): 2/);
  assert.match(out, /nUSD: 1/);
  assert.match(out, /Notes: 0 \(0 unspent \/ spendable\)/);
});

await test("walletStatus: balance read failures degrade to '?' instead of throwing", async () => {
  const { handlers } = makeHandlers({
    publicClient: fakePublicClient({
      getBalance: async () => { throw new Error("rpc down"); },
      readContract: async () => { throw new Error("rpc down"); },
    }),
  });
  await handlers.createWallet();
  const out = await handlers.walletStatus();
  assert.match(out, /AVAX \(gas\): \?/);
  assert.match(out, /nUSD: \?/);
});

// ── deposit ──────────────────────────────────────────────────────────────────

await test("deposit: throws when there is no wallet yet", async () => {
  const { handlers } = makeHandlers();
  await assert.rejects(() => handlers.deposit(), /No wallet — call create_wallet first\./);
});

await test("deposit: mints DENOM then calls poolDeposit with the right args, persists the note", async () => {
  const recorder = [];
  let poolDepositArgs;
  const cfg = fakeConfig();
  const { handlers } = makeHandlers({
    config: cfg,
    walletFor: fakeWalletFor(recorder),
    poolDeposit: async (args) => { poolDepositArgs = args; return { hash: "0xDEPOSITTX", leafIndex: 3 }; },
  });

  await handlers.createWallet();
  const w0 = JSON.parse(readFileSync(cfg.walletPath, "utf8"));

  const out = await handlers.deposit();
  assert.match(out, /Deposited a 1-nUSD note into the pool/);
  assert.match(out, /0xDEPOSITTX/);

  // mint call shape: writeContract({ address: token, abi, functionName: "mint", args: [address, DENOM] })
  assert.equal(recorder.length, 1);
  assert.equal(recorder[0].type, "writeContract");
  assert.equal(recorder[0].args.address, cfg.token);
  assert.equal(recorder[0].args.functionName, "mint");
  assert.deepEqual(recorder[0].args.args, [w0.address, DENOM]);

  // poolDeposit call shape: signerSecret + commitment + amount, using the pool config
  assert.equal(poolDepositArgs.signerSecret, w0.privateKey);
  assert.equal(poolDepositArgs.amount, DENOM);
  assert.equal(poolDepositArgs.poolContractId, cfg.poolContractId);
  assert.equal(typeof poolDepositArgs.commitment, "string");

  const w1 = JSON.parse(readFileSync(cfg.walletPath, "utf8"));
  assert.equal(w1.notes.length, 1);
  assert.equal(w1.notes[0].spent, false);
  assert.equal(w1.notes[0].value, DENOM.toString());
  assert.equal(w1.notes[0].leafIndex, 3);
  assert.equal(w1.notes[0].depositTx, "0xDEPOSITTX");
});

await test("deposit: propagates a mint failure without writing a note", async () => {
  const cfg = fakeConfig();
  const { handlers } = makeHandlers({
    config: cfg,
    walletFor: () => ({ writeContract: async () => { throw new Error("mint reverted"); } }),
  });
  await handlers.createWallet();
  await assert.rejects(() => handlers.deposit(), /mint reverted/);
  const w = JSON.parse(readFileSync(cfg.walletPath, "utf8"));
  assert.equal(w.notes.length, 0);
});

await test("deposit: propagates a poolDeposit (on-chain escrow) failure", async () => {
  const cfg = fakeConfig();
  const { handlers } = makeHandlers({
    config: cfg,
    poolDeposit: async () => { throw new Error("escrow tx reverted"); },
  });
  await handlers.createWallet();
  await assert.rejects(() => handlers.deposit(), /escrow tx reverted/);
});

// ── pay ──────────────────────────────────────────────────────────────────────

await test("pay: throws when there is no wallet yet", async () => {
  const { handlers } = makeHandlers();
  await assert.rejects(() => handlers.pay({ url: "http://example.invalid/api" }), /No wallet — call create_wallet first\./);
});

await test("pay: throws when the wallet has no unspent notes", async () => {
  const { handlers } = makeHandlers();
  await handlers.createWallet();
  await assert.rejects(() => handlers.pay({ url: "http://example.invalid/api" }), /No unspent notes — call deposit first\./);
});

async function depositedHandlers(extra = {}) {
  const cfg = fakeConfig();
  const { handlers } = makeHandlers({ config: cfg, ...extra });
  await handlers.createWallet();
  await handlers.deposit();
  return { cfg, handlers };
}

await test("pay: endpoint that doesn't require payment short-circuits (no proof requested)", async () => {
  let proveCalled = false;
  const { handlers } = await depositedHandlers({
    client: fakeClient({ prove: async (args) => { proveCalled = true; return fakeClient().prove(args); } }),
    fetch: async () => new Response("ok", { status: 200 }),
  });
  const out = await handlers.pay({ url: "http://example.invalid/free" });
  assert.match(out, /Endpoint did not require payment \(HTTP 200\)/);
  assert.equal(proveCalled, false);
});

await test("pay: 402 with missing payment terms is rejected", async () => {
  const { handlers } = await depositedHandlers({
    fetch: async () => new Response(JSON.stringify({ accepts: [] }), { status: 402 }),
  });
  await assert.rejects(() => handlers.pay({ url: "http://example.invalid/x" }), /402 response missing payment terms/);
});

await test("pay: happy path drives 402 -> prove -> retry with X-PAYMENT, marks the note spent", async () => {
  let secondRequestHeaders;
  let fetchCallCount = 0;
  const { cfg, handlers } = await depositedHandlers({
    fetch: async (url, init) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response(
          JSON.stringify({ accepts: [{ payTo: "0xPROVIDER", maxAmountRequired: DENOM.toString() }] }),
          { status: 402 },
        );
      }
      secondRequestHeaders = init.headers;
      return new Response("hello from the api", {
        status: 200,
        headers: { "X-Privacy": "high", "X-Settle-Tx": "0xSETTLETX" },
      });
    },
  });

  const out = await handlers.pay({ url: "http://example.invalid/v1/price/BTC" });
  assert.match(out, /Paid privately — HTTP 200, X-Privacy=high/);
  assert.match(out, /settled on-chain \(1 nUSD → provider\): 0xSETTLETX/);
  assert.match(out, /API response: hello from the api/);

  assert.ok(secondRequestHeaders["X-PAYMENT"], "retry must carry the X-PAYMENT header");

  const w = JSON.parse(readFileSync(cfg.walletPath, "utf8"));
  assert.equal(w.notes[0].spent, true);
  assert.equal(w.notes[0].settleTx, "0xSETTLETX");
});

await test("pay: non-200 settlement response leaves the note unspent", async () => {
  const { cfg, handlers } = await depositedHandlers({
    fetch: async (url, init) => {
      if (!init) {
        return new Response(
          JSON.stringify({ accepts: [{ payTo: "0xPROVIDER", maxAmountRequired: DENOM.toString() }] }),
          { status: 402 },
        );
      }
      return new Response("bad proof", { status: 400, headers: { "X-Settle-Error": "invalid-proof" } });
    },
  });
  const out = await handlers.pay({ url: "http://example.invalid/v1/price/BTC" });
  assert.match(out, /Paid privately — HTTP 400/);
  assert.match(out, /settlement skipped: invalid-proof/);
  const w = JSON.parse(readFileSync(cfg.walletPath, "utf8"));
  assert.equal(w.notes[0].spent, false);
});

await test("pay: unreachable URL (fetch rejects) surfaces as a thrown error, not a crash", async () => {
  const { handlers } = await depositedHandlers({
    fetch: async () => { throw new TypeError("fetch failed"); },
  });
  await assert.rejects(() => handlers.pay({ url: "http://unreachable.invalid/x" }), /fetch failed/);
});

// ── sanity: default export uses the real production config shape ───────────

await test("module-level config: defaults are well-formed (used by index.mjs / selftest.mjs)", () => {
  assert.equal(typeof prodConfig.rpcUrl, "string");
  assert.equal(typeof prodConfig.chainId, "number");
  assert.ok(prodConfig.walletPath.length > 0);
});

console.log(`\n${passed} checks passed`);
console.log(process.exitCode ? "FAILED" : "ALL PASS");

// Ensure a clean, prompt exit even if viem/undici left any sockets/timers open.
process.exit(process.exitCode ?? 0);
