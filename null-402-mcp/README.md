# null-402-mcp

> **An MCP server that lets any agent pay x402 APIs privately on Stellar.**
> Plug it into Claude (Desktop / Code) or any MCP client and your agent can
> create a wallet, deposit into the null-402 privacy pool, and pay
> x402-protected endpoints with a zero-knowledge proof — revealing only a
> nullifier, never the wallet, amount, or endpoint.

## Tools

| Tool | What it does |
|---|---|
| `create_wallet` | Generate + fund a Stellar testnet wallet |
| `wallet_status` | Address, XLM balance, spendable notes |
| `deposit` | Escrow a **1-XLM note** into the pool (fixed denomination, real on-chain tx) |
| `pay` | Pay an x402 URL with a note → the gateway verifies **and settles on-chain** (1 XLM → provider); returns the API response + the settle tx. Only a nullifier is revealed. |

## Plug into Claude

`claude_desktop_config.json` (or Claude Code MCP config):

```json
{
  "mcpServers": {
    "null-402": {
      "command": "node",
      "args": ["/ABS/PATH/null-402-mcp/src/index.mjs"],
      "env": { "NULL402_WALLET": "/ABS/PATH/.null-402/wallet.json" }
    }
  }
}
```

Then ask Claude: *“deposit 1 XLM, then pay https://…/v1/price/BTC privately and tell me the price.”*

## Prerequisites

```bash
(cd ../null-402-circuits && npm install && npm run build)   # proving artifacts
(cd ../null-402-sdk      && npm install && npm run build)   # SDK → dist
(cd ../null-402-gateway  && npm install && npm run build)   # gateway → dist
npm install
```

## 🤖 Autonomous agent demo (Groq)

A Groq LLM, given the null-402 MCP tools, **autonomously** sets up a wallet,
deposits a note, and pays an x402 API privately:

```bash
GROQ_API_KEY=…  NULL402_PROVIDER=$(stellar keys address null402)  npm run agent
```

Real run (`llama-3.3-70b-versatile`):

```
🤖 Groq agent + null-402 MCP
  MCP tools: create_wallet, wallet_status, deposit, pay
  paid API: http://localhost:52138/v1/price/BTC

  → agent calls create_wallet({})
      Created + funded a Stellar testnet wallet: GDMCK3XD…44EC
  → agent calls deposit({})
      Deposited a 1-XLM note. deposit tx: 0ad8a31135a26c329e0479e45c8ca8a18287b0a0121fe0a3cbb3b9669f082c0d
  → agent calls pay({"url":"http://localhost:…/v1/price/BTC"})
      Paid privately — HTTP 200, X-Privacy=zk-groth16.
      The only thing revealed on-chain: nullifier 139508983317078515095272…
      settled on-chain (1 XLM → provider): 3969f955df784adb01a49665dab84122cacbbad448585a70dacd06b9117fea2b
      API response: { … "price": 52406.13 … }

  💬 agent answer: The current BTC price is $52,406.13.
```

- deposit: <https://stellar.expert/explorer/testnet/tx/0ad8a31135a26c329e0479e45c8ca8a18287b0a0121fe0a3cbb3b9669f082c0d>
- settle (verify → pay provider 1 XLM, on-chain): <https://stellar.expert/explorer/testnet/tx/3969f955df784adb01a49665dab84122cacbbad448585a70dacd06b9117fea2b>

The deposit is public; the **payment + settlement reveal only a nullifier** — not
which agent paid, how much, or which endpoint.

## Self-test (no LLM)

Exercises the tool logic against a real local gateway + the deployed testnet
contracts:

```bash
NULL402_PROVIDER=$(stellar keys address null402) npm run selftest
```

```
[create_wallet] Created + funded: GCOABGVQ…OAYV
[deposit]       deposit tx: 5130128fe295a35441d27fea10b47a51f4f5df92c30f2cff0286c30aceafee10
[pay + settle]  Paid privately — HTTP 200, X-Privacy=zk-groth16.
                settled on-chain (1 XLM → provider): f551e134a0dcdf3fd85695bf867313d59a4317a302f94d3f4c7a35911545be25
                API response: { … "price": 52797.80 … }
OK - MCP tools work end-to-end (real deposit + private x402 pay + on-chain settle).
```

## How `pay` works

1. `GET url` → `402` with the payment terms (payTo, price).
2. Pick an unspent note → generate a real Groth16 proof bound to (gateway, price,
   request) — locally, secrets never leave.
3. Retry with `X-PAYMENT: <proof>` → the gateway verifies the proof **on-chain**
   (Soroban BN254 pairing) → `200` + the API response.
4. The gateway operator **settles on-chain**: `pool.settle` re-runs the pairing
   check, spends the nullifier, and pays the provider **1 XLM** from the pool. The
   settle tx is returned in `X-Settle-Tx`.

Notes are a **fixed 1-XLM denomination**, so the operator settles an exact amount
without learning anything about the note — preserving the privacy of the spend.
(Settlement here is synchronous for the demo; a production gateway would batch it.)

Deployed testnet contracts (defaults; override via `NULL402_POOL` / `NULL402_VERIFIER`):

| | id |
|---|---|
| Pool | `CCVYSIWUAOZYFVAM6R76DMKDY4Y52SFIPY6CX3HBMUFF5Q4YS32C24XL` |
| Verifier | `CDCYYFSJ7QC7RO6L2DHWK6X6IMZ5U5J3IEAKLKTBTBDX45LWO32JQJLV` |

> Wallets are stored locally (`NULL402_WALLET`) and **never committed**. This is a
> testnet demo — don't put real funds in the file-based wallet.
