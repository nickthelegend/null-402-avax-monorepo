# null-402-examples

Runnable, **no-mock** examples for [`null-402`](../null-402-sdk) — real Circom/Groth16
proofs, the real gateway, and real on-chain verification + settlement on Stellar
**testnet**.

## Prerequisites (build the pieces the examples import)

```bash
(cd ../null-402-circuits && npm install && npm run build)   # circuit + proving artifacts
(cd ../null-402-sdk      && npm install && npm run build)   # SDK → dist
(cd ../null-402-gateway  && npm install && npm run build)   # gateway → dist
```

---

## 🤖 `agent.mjs` — an autonomous agent that pays privately (fully on-chain)

An agent with its own Stellar keypair **escrows real XLM** into the pool, then
pays a gateway per call with a zero-knowledge proof. The operator **settles
on-chain** — and the settlement reveals only a nullifier, never the agent.

```bash
export NULL402_AGENT_SECRET=$(stellar keys show agent)
export NULL402_OPERATOR_SECRET=$(stellar keys show null402)
export NULL402_AGENT=$(stellar keys address agent)
export NULL402_PROVIDER=$(stellar keys address null402)
node agent.mjs
```

### Real run (Stellar testnet)

```
1. Agent deposits a 1-XLM note into the pool (on-chain, signed by the agent)
   deposit tx → 447d0ef8427bf2ad161db726cb093167fa07ec4d686708c35c7bf56a406d3bd4
   leaf index 2 · commitment recorded on-chain
   pool now holds 3 commitment(s); ours present: yes
2. Agent proves a payment and calls the paid API
   GET /v1/price/BTC → 200 OK  X-Privacy=zk-groth16  (verified on-chain)
3. Operator settles on-chain (pays the provider, spends the nullifier)
   settle tx → db18bb8e5dd0dd932d4bcb2609dcfc65148e18b56237bf958a8ffcaca24a91b0
4. What the chain reveals
   deposit tx  → shows the AGENT escrowing XLM        (public, like any privacy-pool deposit)
   settle  tx  → shows only nullifier 134081754588… + payout
                NOT linkable to the agent
```

- Deposit: <https://stellar.expert/explorer/testnet/tx/447d0ef8427bf2ad161db726cb093167fa07ec4d686708c35c7bf56a406d3bd4>
- Settle (on-chain Groth16 verify → payout): <https://stellar.expert/explorer/testnet/tx/db18bb8e5dd0dd932d4bcb2609dcfc65148e18b56237bf958a8ffcaca24a91b0>

### The privacy model (honest)

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

---

## 🌳 `anonymity.mjs` — the anonymity set is real

Deposits two notes and proves each against the **shared** on-chain Merkle tree —
showing both reference the **same root**, verified on-chain. One shared root means
a settlement's nullifier can't be linked to a deposit (real unlinkability).

```bash
NULL402_OPERATOR_SECRET=$(stellar keys show null402) NULL402_PROVIDER=$(stellar keys address null402) node anonymity.mjs
```

```
deposited note 1 at leaf 8   deposited note 2 at leaf 9
note @ leaf 8: root 711715908982…  on-chain verify = ✓ true
note @ leaf 9: root 711715908982…  on-chain verify = ✓ true
both notes share ONE root: ✓ YES
```

## 🔁 `e2e-demo.mjs` — full flow + privacy assertion

Real proof → real gateway endpoints → real on-chain verification, with an
assertion that **no secret crosses the wire**, and replay / tampered /
wrong-recipient all rejected.

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

Both demos need network (Stellar testnet); `e2e-demo.mjs` skips the on-chain
section cleanly if offline.

## Deployed testnet contracts

| | id |
|---|---|
| Verifier (Groth16/BN254) | `CDCYYFSJ7QC7RO6L2DHWK6X6IMZ5U5J3IEAKLKTBTBDX45LWO32JQJLV` |
| Pool (escrow + nullifiers) | `CCVYSIWUAOZYFVAM6R76DMKDY4Y52SFIPY6CX3HBMUFF5Q4YS32C24XL` |
| Token (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
