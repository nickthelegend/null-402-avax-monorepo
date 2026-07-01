/**
 * Self-test: exercises the MCP tool logic against a real local gateway + the
 * deployed testnet contracts. create_wallet → deposit → pay (real x402, on-chain
 * verify). Uses a throwaway wallet file.
 *
 *   NULL402_PROVIDER=<funded testnet G-address> node src/selftest.mjs
 */

process.env.NULL402_WALLET = process.env.NULL402_WALLET ?? "/tmp/null402-selftest-wallet.json";

const t = await import("./lib.mjs");
const { startGateway } = await import("./gateway-server.mjs");

const provider = process.env.NULL402_PROVIDER;
const operatorSecret = process.env.NULL402_OPERATOR_SECRET;
if (!provider || !operatorSecret) {
  console.error("Set NULL402_PROVIDER + NULL402_OPERATOR_SECRET (the funded operator/provider).");
  process.exit(1);
}

const gw = await startGateway({ payTo: provider, sourceAccount: provider, operatorSecret });
console.log("local gateway (settling):", gw.url, "\n");

try {
  console.log("[create_wallet]\n" + (await t.createWallet()) + "\n");
  console.log("[deposit]\n" + (await t.deposit()) + "\n");
  console.log("[pay /v1/price/BTC + settle]\n" + (await t.pay({ url: gw.url + "/v1/price/BTC" })) + "\n");
  console.log("[wallet_status]\n" + (await t.walletStatus()));
  console.log("\nOK - MCP tools work end-to-end (real deposit + private x402 pay).");
} finally {
  gw.close();
}
