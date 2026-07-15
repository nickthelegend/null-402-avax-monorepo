# null-402-contracts (Avalanche / Solidity)

The on-chain layer of null-402, migrated from Soroban (Rust) to **Solidity** on
Avalanche Fuji. Built with Foundry.

| Contract | Role |
|---|---|
| `src/Groth16Verifier.sol` | Groth16/BN254 verifier, **exported from the payment circuit** via `snarkjs zkey export solidityverifier`. `verifyProof(a,b,c,pubSignals[5])` runs the pairing check on the EVM precompiles. |
| `src/Null402Pool.sol` | The shielded pool: `deposit(commitment, amount)` escrows an ERC-20 and records a note commitment; `settle(a,b,c,pub,recipient,amount)` verifies the proof on-chain, burns the nullifier (single-use), and pays the provider. |
| `src/MockUSD.sol` | Mintable test ERC-20 (`nUSD`, 7 decimals) — the escrow/payout asset. |

Public signals (fixed circuit order): `[nullifier, merkleRoot, payTo, requiredAmount, contextHash]`.

## Test & deploy

```bash
forge test -vv                 # verifies a REAL snarkjs proof on-chain + settle/replay/auth/tamper guards

PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url fuji --broadcast
```

## Deployed (Fuji 43113)

- Verifier `0x0b44836dDc460f589ce4EB97f276e533A2bE6060`
- Pool `0x39a9C4EfabEBA954545Ecb4b16Ba1d92ec46cA1C`
- nUSD `0xabea27277b0189c4C054020Ea609060A9292Ee9C`

The original Soroban (Rust) implementation is kept for reference under
[`soroban-legacy/`](./soroban-legacy).
