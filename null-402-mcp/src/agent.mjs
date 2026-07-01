/**
 * Autonomous agent that pays for an x402 API privately — over the real MCP
 * protocol, no LLM key required. It connects to the null-402 MCP server (a
 * separate process) via stdio, then plans and executes: ensure a funded wallet
 * with a spendable note, then pay the endpoint with a ZK proof. Only a nullifier
 * is revealed on-chain; the payment is verified + settled on Avalanche Fuji.
 *
 *   NULL402_PROVIDER=0x... NULL402_OPERATOR_SECRET=0x... NULL402_FUNDER_KEY=0x... \
 *     node src/agent.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { startGateway } from "./gateway-server.mjs";

const PROVIDER = process.env.NULL402_PROVIDER;
const OPERATOR_SECRET = process.env.NULL402_OPERATOR_SECRET;
if (!PROVIDER || !OPERATOR_SECRET) {
  console.error("Set NULL402_PROVIDER (0x provider) and NULL402_OPERATOR_SECRET (operator key).");
  process.exit(1);
}
const b = (s) => `\x1b[1m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`, ok = (s) => `\x1b[32m${s}\x1b[0m`;

// 1) a real x402 gateway to pay (verifies on-chain via eth_call AND settles).
const gw = await startGateway({ payTo: PROVIDER, operatorSecret: OPERATOR_SECRET });

// 2) connect to the null-402 MCP server (separate process, fresh wallet).
const walletPath = `/tmp/null402-agent-${process.pid}.json`;
const transport = new StdioClientTransport({
  command: "node",
  args: [fileURLToPath(new URL("./index.mjs", import.meta.url))],
  env: { ...process.env, NULL402_WALLET: walletPath },
});
const mcp = new Client({ name: "null-402-agent", version: "1.0.0" });
await mcp.connect(transport);
const { tools } = await mcp.listTools();

const url = `${gw.url}/v1/price/BTC`;
console.log(b("\n  🤖 null-402 autonomous agent (over MCP)\n"));
console.log(`  MCP tools : ${tools.map((t) => t.name).join(", ")}`);
console.log(`  task      : get the BTC price from ${url} and pay for it privately\n`);

const call = async (name, args = {}) => {
  const res = await mcp.callTool({ name, arguments: args });
  return res.content?.[0]?.text ?? "";
};
const step = (n, s) => console.log(`  ${b(`[${n}]`)} ${dim(s)}`);

try {
  // Plan (no LLM needed): check wallet → ensure a spendable note → pay.
  step("plan", "checking wallet…");
  let status = await call("wallet_status");
  if (/No wallet/.test(status)) {
    step("create_wallet", "no wallet — creating + funding one");
    console.log("    " + (await call("create_wallet")).replace(/\n/g, "\n    "));
    status = await call("wallet_status");
  }
  if (!/[1-9]\d* unspent/.test(status)) {
    step("deposit", "no spendable note — depositing into the pool");
    console.log("    " + (await call("deposit")).replace(/\n/g, "\n    "));
  }
  step("pay", "hitting the 402, proving, and paying privately");
  const result = await call("pay", { url });
  console.log("    " + result.replace(/\n/g, "\n    "));

  const paid = /HTTP 200/.test(result);
  console.log("\n  " + (paid ? ok("✅ agent paid for the API privately, verified on Avalanche") : "✗ agent did not complete the payment"));
  process.exitCode = paid ? 0 : 1;
} finally {
  await mcp.close().catch(() => {});
  gw.close();
  // gateway's node-server keeps the loop alive; exit explicitly once done.
  setTimeout(() => process.exit(process.exitCode ?? 0), 250);
}
