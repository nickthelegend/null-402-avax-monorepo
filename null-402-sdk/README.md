# null-402

> Private pay-per-call on Avalanche. x402, but the payment is a zero-knowledge
> proof — no wallet, amount, or endpoint is revealed on-chain or to the gateway.

Any API provider can accept private payments in a few lines. Any client can pay
without leaking who they are, what they paid, or what they called.

## Server — gate an endpoint

```ts
import { verifyPayment, build402, evmVerifier, memoryNullifierStore } from "null-402/server";

const cfg = {
  requiredAmount: 1_000,                       // price tier
  payTo: "0x…gateway",                          // your gateway EVM address
  verifier: evmVerifier({ rpcUrl, verifierContractId, chainId: 43113 }), // Avalanche Fuji
  nullifiers: memoryNullifierStore(),           // swap for KV / Durable Object / DB
};

const out = await verifyPayment(
  { method: req.method, path: url.pathname, paymentHeader: req.headers.get("X-PAYMENT") },
  cfg,
);
if (!out.ok) { /* 402 via build402(...) or 4xx with out.reason */ }
else { /* serve the resource — out.result.valid === true */ }
```

## Client — pay privately

```ts
import { Null402Client, groth16Prover } from "null-402/client";

const client = new Null402Client({
  evm: { rpcUrl, chainId: 43113, poolContractId, verifierContractId }, // Avalanche Fuji
  prover: groth16Prover({ wasmPath, zkeyPath }),
});

const note = await client.deposit(10_000n);     // one-time, funds the pool
const res = await client.pay("https://api.example.com/v1/price/BTC", {
  note, merkleRoot, method: "GET",
});                                              // handles 402 → prove → retry
```

## How it works

```
deposit → private note (Poseidon commitment in the Pool's Merkle tree)
call    → Groth16 proof: "I own an unspent note ≥ price, bound to THIS request"
verify  → on-chain Groth16 verifier (eth_call on Avalanche Fuji) returns valid:bool; nullifier blocks replay
```

Verifier / Policy / Application are split: the verifier checks only cryptographic
validity, the gate enforces recipient + amount tier + request binding + replay,
your app runs only after both pass.

## On-chain helpers

The SDK also talks to the deployed pool directly (real value moves):

```ts
import { poolDeposit, poolCommitments, poolSettle } from "null-402";
// poolDeposit  → agent escrows nUSD + records its commitment   (signed tx)
// poolCommitments → read the on-chain commitment list (build the tree off-chain)
// poolSettle   → operator: on-chain Groth16 verify → pay provider → spend nullifier
```

## Tests

```
npm test            # dev flow + unit + note-commitment      → 42/42
npm run test:real   # real Groth16 prove+verify (snarkjs)     → 4/4
npm run test:live   # live verify on Avalanche Fuji (opt-in)  → set NULL402_RUN_LIVE_TESTS=1
```

`test:real` generates a real proof and verifies it with snarkjs; `test:live`
(env-gated: `NULL402_RUN_LIVE_TESTS=1`) verifies the same proof against the
**deployed Fuji verifier** contract via `eth_call`. See `../TESTING.md` for the
full matrix.

## Real vs. scaffold

- `groth16Prover` / `localGroth16Verifier` / `evmVerifier` — the **real** path
  (snarkjs proof, off-chain verify, and on-chain verify on Avalanche via `eth_call`).
- `devVerifier` / `devProver` — an **insecure** local scaffold, gated behind
  `allowInsecure: true`, for offline dev only.

MIT.
