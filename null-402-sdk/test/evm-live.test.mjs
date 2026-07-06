// Live SDK test against the deployed null-402 contracts on Avalanche Fuji.
// Verifies the real Groth16 proof via evmVerifier (eth_call) and settles it
// through the pool (operator tx → pays provider, burns nullifier).
//
// NOT run as part of the local/offline test suite: this hits the live Fuji
// RPC (eth_call, and — if NULL402_OPERATOR_KEY is set — a broadcast tx). To
// avoid nonce collisions with other agents sharing the funded key, this test
// is opt-in only and skips cleanly (exit 0) unless explicitly enabled:
//
//   NULL402_RUN_LIVE_TESTS=1 NULL402_OPERATOR_KEY=0x... node test/evm-live.test.mjs
if (process.env.NULL402_RUN_LIVE_TESTS !== "1") {
  console.log("null-402 SDK — live Fuji EVM path");
  console.log(
    "  … skipped (set NULL402_RUN_LIVE_TESTS=1 to run against live Avalanche Fuji; " +
      "requires network access and, for the settle check, NULL402_OPERATOR_KEY)",
  );
  process.exit(0);
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evmVerifier, poolSettle } from "../dist/index.js";
import { createPublicClient, http, defineChain } from "viem";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const circ = (f) => JSON.parse(readFileSync(`${HERE}../../null-402-circuits/build/${f}`, "utf8"));

const RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const VERIFIER = "0x0b44836dDc460f589ce4EB97f276e533A2bE6060";
const POOL = "0x3f528ab5A5e258f75692A3A9F4441D1E54eBB511";
const TOKEN = "0xabea27277b0189c4C054020Ea609060A9292Ee9C";
const OPERATOR_KEY = process.env.NULL402_OPERATOR_KEY;
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const proof = circ("proof.json");
const pub = circ("public.json"); // [nullifier, merkleRoot, payTo, requiredAmount, contextHash]
const bundle = {
  proof,
  publicSignals: {
    nullifier: pub[0], merkleRoot: pub[1], payTo: pub[2], requiredAmount: pub[3], contextHash: pub[4],
  },
};

const chain = defineChain({
  id: 43113, name: "fuji", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({ chain, transport: http(RPC) });
const POOL_ABI = [{ type: "function", name: "isSpent", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] }];
const ERC20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); if (!c) failed++; };

console.log("null-402 SDK — live Fuji EVM path\n");

// 1) evmVerifier over eth_call
const verifier = evmVerifier({ rpcUrl: RPC, verifierContractId: VERIFIER });
const valid = await verifier.verify(bundle);
ok(valid === true, `evmVerifier.verify(realProof) === true (mode=${verifier.mode})`);

// 2) tampered proof → false
const tampered = { ...bundle, publicSignals: { ...bundle.publicSignals, nullifier: (BigInt(pub[0]) + 1n).toString() } };
ok((await verifier.verify(tampered)) === false, "evmVerifier rejects tampered public input");

// 3) settle on-chain (needs operator key)
if (OPERATOR_KEY) {
  const nullifier = BigInt(pub[0]);
  const already = await client.readContract({ address: POOL, abi: POOL_ABI, functionName: "isSpent", args: [nullifier] });
  if (already) {
    console.log("  … nullifier already spent on-chain (a previous run settled it) — skipping settle");
  } else {
    const before = await client.readContract({ address: TOKEN, abi: ERC20, functionName: "balanceOf", args: [RECIPIENT] });
    const price = 1000n;
    const { hash } = await poolSettle({
      rpcUrl: RPC, poolContractId: POOL, operatorSecret: OPERATOR_KEY, bundle, recipient: RECIPIENT, amount: price,
    });
    console.log(`    settle tx: https://testnet.snowtrace.io/tx/${hash}`);
    const after = await client.readContract({ address: TOKEN, abi: ERC20, functionName: "balanceOf", args: [RECIPIENT] });
    const spent = await client.readContract({ address: POOL, abi: POOL_ABI, functionName: "isSpent", args: [nullifier] });
    ok(after - before === price, `provider paid ${price} nUSD on settle`);
    ok(spent === true, "nullifier burned on-chain");
  }
} else {
  console.log("  … set NULL402_OPERATOR_KEY to also test on-chain settle");
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : "\n✅ SDK EVM path verified live on Fuji");
process.exit(failed ? 1 : 0);
