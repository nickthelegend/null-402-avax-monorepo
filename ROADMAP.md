# null-402 — roadmap

null-402 is **x402 where the payment is a zero-knowledge proof**, migrated from
Stellar/Soroban to **Avalanche Fuji (EVM)**. This tracks what's done and what's next.

> Note: null-402 uses its **own** Circom Groth16 shielded-pool circuit — it is
> *not* Avalanche's eERC. (eERC is a confidential-token standard; null-402 is a
> confidential pay-per-call layer built on a custom UTXO-note circuit.)

## Done — migrated & verified on Fuji

- [x] **Circuit** (`null-402-circuits`) — Circom `Payment(20)`, Groth16/BN254,
      Poseidon depth-20 Merkle tree, 5 public signals
      `[nullifier, merkleRoot, payTo, requiredAmount, contextHash]`. Chain-agnostic.
- [x] **Solidity verifier** — exported from the proving key via
      `snarkjs zkey export solidityverifier`; pairing check on the EVM precompiles.
- [x] **`Null402Pool.sol`** — `deposit(commitment, amount)` escrow +
      `settle(a,b,c,pub,recipient,amount)` (verify → burn nullifier → pay). Foundry: **5/5**.
- [x] **Deployed to Fuji (43113)** — verifier `0x0b44…6060`, pool `0x3f52…B511`,
      nUSD `0xabea…Ee9C`.
- [x] **SDK** (`null-402`) — `@stellar/stellar-sdk` → **viem**; `evm.ts`
      (deposit/commitments/settle) + `evmVerifier` (eth_call). Verified live
      (verify + settle on-chain). flow 7/7, real-proof 4/4.
- [x] **Gateway** — verifier select → `evmVerifier`; env → EVM. http test **4/4**.
- [x] **MCP server + agent** — an agent creates a wallet, deposits, and pays x402
      APIs with a ZK proof verified + settled on Fuji; only a nullifier revealed.
      Keyless autonomous agent over MCP stdio — verified live.
- [x] **e2e-demo** — 402 → prove → 200 (on-chain verify), privacy held,
      replay / tampered / wrong-recipient all rejected.

## Next

- [ ] Trust-minimize the operator/settlement path (currently a trusted relayer).
- [ ] Persist nullifier + root indexing in a durable store for production gateways.
- [ ] Deposit-side privacy: batch/relayer submission so the deposit tx doesn't
      link the depositor address to a commitment.
- [ ] Dashboard: wire the browser demo to `evmVerifier` on Fuji end-to-end.
- [ ] Converter-style flow: pay from an existing ERC-20 (e.g. USDC) balance.

## Proven on-chain (Snowtrace)

- deposit: `0x12b58ee7…d8d1a7`
- settle (verify → pay provider): `0x0b135bef…de7d0f`
