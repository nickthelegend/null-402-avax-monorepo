# null-402-mcp

> **An MCP server that lets any agent pay x402 APIs privately on Avalanche.**

Plug it into any MCP client (Claude Desktop, Claude Code, …). The agent gets four
tools and can autonomously set up a wallet, escrow into the shielded pool, and
pay per API call with a Groth16 proof verified on-chain (Fuji). Only a nullifier
is ever revealed — never the address, amount, or which endpoint.

| Tool | Does |
|---|---|
| `create_wallet` | Generate + fund an Avalanche Fuji wallet |
| `wallet_status` | Address, AVAX (gas) + nUSD balance, spendable notes |
| `deposit` | Escrow a 1-nUSD note into the null-402 pool |
| `pay` | Pay an x402 URL with a note → the gateway verifies **and settles on-chain** (1 nUSD → provider); returns the API response + the settle tx. Only a nullifier is revealed. |

## Claude Desktop / Claude Code config

```json
{ "mcpServers": { "null-402": { "command": "node",
    "args": ["/abs/path/null-402-mcp/src/index.mjs"],
    "env": { "NULL402_FUNDER_KEY": "0x<operator key with Fuji AVAX>" } } } }
```

Defaults point at the deployed Fuji contracts (override with `NULL402_POOL`,
`NULL402_VERIFIER`, `NULL402_TOKEN`, `NULL402_RPC`).

## Autonomous agent (no LLM key needed)

`src/agent.mjs` connects to the MCP server over stdio and pays for an API
autonomously — real end-to-end:

```bash
NULL402_PROVIDER=0x<provider> NULL402_OPERATOR_SECRET=0x<operator> \
  NULL402_FUNDER_KEY=0x<operator> npm run agent
```

```
  🤖 null-402 autonomous agent (over MCP)
  [create_wallet]  Created an Avalanche Fuji wallet (funded 0.05 AVAX for gas)
  [deposit]        Deposited a 1-nUSD note into the pool
  [pay]            Paid privately — HTTP 200, X-Privacy=zk-groth16
                   settled on-chain (1 nUSD → provider): 0x0b13…7d0f
                   API response: {"symbol":"BTC","price":60187.7,...}
  ✅ agent paid for the API privately, verified on Avalanche
```

`npm run agent:groq` runs the same over a Groq LLM (set `GROQ_API_KEY`).

## Proven live on Fuji (Snowtrace)

- deposit: <https://testnet.snowtrace.io/tx/0x12b58ee7a1bdd8463eebc14357a6d09fe5d58b53b82b7e5b05a46c6997d8d1a7>
- settle (verify → pay provider 1 nUSD): <https://testnet.snowtrace.io/tx/0x0b135befaf2f1ec7870461ba0488f0c4e4b938a81b9bdb4ac6ae67434bde7d0f>

`npm run selftest` runs the whole flow (create → deposit → pay + settle) directly.
