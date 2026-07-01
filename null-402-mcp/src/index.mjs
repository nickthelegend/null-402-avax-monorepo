#!/usr/bin/env node
/**
 * null-402 MCP server — plug into any MCP client (Claude Desktop, Claude Code, …)
 * and let the agent pay x402 APIs privately on Avalanche.
 *
 * Tools: create_wallet · wallet_status · deposit · pay
 *
 * Claude Desktop config (claude_desktop_config.json):
 *   { "mcpServers": { "null-402": { "command": "node",
 *       "args": ["/abs/path/null-402-mcp/src/index.mjs"] } } }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as t from "./lib.mjs";

const server = new McpServer({ name: "null-402", version: "0.1.0" });

const ok = (s) => ({ content: [{ type: "text", text: s }] });
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}));
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
};

server.registerTool(
  "create_wallet",
  { description: "Generate and fund an Avalanche Fuji wallet to pay privately with.", inputSchema: {} },
  wrap(() => t.createWallet()),
);

server.registerTool(
  "wallet_status",
  { description: "Show the wallet address, AVAX (gas) + nUSD balance, and how many private notes are spendable.", inputSchema: {} },
  wrap(() => t.walletStatus()),
);

server.registerTool(
  "deposit",
  {
    description: "Deposit a 1-nUSD note into the null-402 privacy pool (fixed denomination) to pay with.",
    inputSchema: {},
  },
  wrap(() => t.deposit()),
);

server.registerTool(
  "pay",
  {
    description:
      "Privately pay an x402-protected API endpoint with a note and return the API response. " +
      "Only a nullifier is revealed on-chain — never your address, amount, or which endpoint.",
    inputSchema: { url: z.string().url().describe("the x402 API URL to pay and fetch") },
  },
  wrap(t.pay),
);

await server.connect(new StdioServerTransport());
console.error("null-402 MCP server ready (stdio).");
