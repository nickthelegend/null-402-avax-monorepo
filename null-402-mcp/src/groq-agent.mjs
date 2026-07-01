/**
 * Groq-powered agent that uses the null-402 MCP server to pay an x402 API
 * privately — fully autonomous tool-calling.
 *
 * The agent (a Groq LLM) is given the null-402 tools (create_wallet, deposit,
 * wallet_status, pay) over MCP. Asked for a paid API's data, it sets up a wallet,
 * deposits a note, and pays the endpoint with a ZK proof — then answers.
 *
 *   GROQ_API_KEY=… NULL402_PROVIDER=<funded 0x address> node src/groq-agent.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { startGateway } from "./gateway-server.mjs";

const GROQ_KEY = process.env.GROQ_API_KEY;
const PROVIDER = process.env.NULL402_PROVIDER;
const OPERATOR_SECRET = process.env.NULL402_OPERATOR_SECRET;
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
if (!GROQ_KEY || !PROVIDER || !OPERATOR_SECRET) {
  console.error("Set GROQ_API_KEY, NULL402_PROVIDER, and NULL402_OPERATOR_SECRET.");
  process.exit(1);
}

const b = (s) => `\x1b[1m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`, ok = (s) => `\x1b[32m${s}\x1b[0m`;

// 1) a real x402 gateway to pay (local HTTP, verifies on-chain AND settles)
const gw = await startGateway({ payTo: PROVIDER, operatorSecret: OPERATOR_SECRET });

// 2) connect to the null-402 MCP server (separate process, fresh wallet)
const transport = new StdioClientTransport({
  command: "node",
  args: [fileURLToPath(new URL("./index.mjs", import.meta.url))],
  env: { ...process.env, NULL402_WALLET: "/tmp/null402-agent-wallet.json", NULL402_PROVIDER: PROVIDER },
});
const mcp = new Client({ name: "groq-agent", version: "1.0.0" });
await mcp.connect(transport);
const { tools } = await mcp.listTools();
console.log(b("\n  🤖 Groq agent + null-402 MCP\n"));
console.log(`  model: ${MODEL}`);
console.log(`  MCP tools: ${tools.map((t) => t.name).join(", ")}`);
console.log(`  paid API: ${gw.url}/v1/price/BTC\n`);

// MCP tools → Groq (OpenAI-compatible) tool schemas
const groqTools = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema ?? { type: "object", properties: {} } },
}));

const messages = [
  {
    role: "system",
    content:
      "You are an autonomous agent that pays for APIs privately using null-402 on Avalanche. " +
      "Use the tools to set up a funded wallet, deposit a note, and pay x402 endpoints. " +
      "Do whatever setup is needed before paying. Be concise.",
  },
  {
    role: "user",
    content: `Get the current BTC price. It's a paid API at ${gw.url}/v1/price/BTC — pay for it privately and tell me the price.`,
  },
];

async function groq(body) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`);
  return r.json();
}

try {
  for (let turn = 0; turn < 8; turn++) {
    const res = await groq({ model: MODEL, messages, tools: groqTools, tool_choice: "auto", temperature: 0 });
    const msg = res.choices[0].message;
    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments || "{}");
        console.log(`  ${cyan("→ agent calls")} ${b(call.function.name)}(${dim(JSON.stringify(args))})`);
        const out = await mcp.callTool({ name: call.function.name, arguments: args });
        const text = out.content?.map((c) => c.text).join("\n") ?? "";
        console.log(dim("    " + text.replace(/\n/g, "\n    ")) + "\n");
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
      continue;
    }

    console.log(b("  💬 agent answer:\n"));
    console.log("  " + ok(msg.content.replace(/\n/g, "\n  ")) + "\n");
    break;
  }
} finally {
  await mcp.close();
  gw.close();
}
