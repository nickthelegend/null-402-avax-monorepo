# null-402-examples

Runnable, **no-mock** example for [`null-402`](../null-402-sdk) — a real
Circom/Groth16 proof, the real gateway, and real on-chain verification on
Avalanche **Fuji**.

## Prerequisites (build the pieces the example imports)

```bash
(cd ../null-402-circuits && npm install && npm run build)   # circuit + proving artifacts
(cd ../null-402-sdk      && npm install && npm run build)   # SDK → dist
(cd ../null-402-gateway  && npm install && npm run build)   # gateway → dist
```

## 🔁 `e2e-demo.mjs` — full flow + privacy assertion

Real Circom/Groth16 proof (snarkjs) → real gateway endpoints (Hono) → real BN254
verification (Solidity `Groth16Verifier` on Avalanche Fuji). Shows the privacy
contrast, the `402 → prove → 200` flow, asserts **no secret crosses the wire**,
and that replay / tampered / wrong-recipient payments are rejected. Needs no env
vars; it skips the on-chain section cleanly if offline.

```bash
npm run demo            # node e2e-demo.mjs
```

```
4b. Privacy assertion — secrets are absent from the wire and the response
   note secret          in X-PAYMENT: absent   in response: absent
   nullifier secret     in X-PAYMENT: absent   in response: absent
   exact value (5000)   in X-PAYMENT: absent   in response: absent
   PRIVACY HELD — no secret crossed the wire
5. Replay → 402   6. Tampered → 402 (pairing fails on-chain)   7. Wrong recipient → 400
```

## 🤖 Autonomous agent that pays privately

The "agent escrows funds, then pays a gateway per call with a ZK proof, and the
operator settles on-chain" flow lives in [`../null-402-mcp`](../null-402-mcp) — an
MCP server exposing `create_wallet` / `deposit` / `pay` tools an AI agent drives
with no human in the loop. See that package's README + `npm test` (20 unit tests).

## The privacy model (honest)

null-402 is a **Privacy-Pool**-style system:

- **Deposits are public** — the settle txn pays out of a shared pool, and the
  agent's deposit is visible (like any pool deposit).
- **Payments reveal nothing** — the proof's public signals are a nullifier, the
  pool root, and request bindings. No agent identity; the gateway logs nothing.
- **Settlements are unlinkable** — the settle txn shows only a nullifier, which
  cannot be tied back to a specific deposit/agent. With N deposits in the pool,
  the anonymity set is N.

So the **payment and settlement reveal nothing about which agent paid** — that's
the guarantee. (Practical privacy scales with the number of deposits.)

## Deployed Fuji (43113) contracts

| | address |
|---|---|
| Verifier (Groth16/BN254) | `0x0b44836dDc460f589ce4EB97f276e533A2bE6060` |
| Pool (escrow + nullifiers) | `0x3f528ab5A5e258f75692A3A9F4441D1E54eBB511` |
| Token (nUSD) | `0xabea27277b0189c4C054020Ea609060A9292Ee9C` |

See [`../TESTING.md`](../TESTING.md) for the full test matrix.
