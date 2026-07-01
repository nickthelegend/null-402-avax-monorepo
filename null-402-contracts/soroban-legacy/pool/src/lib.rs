#![no_std]
//! null-402 pool (Soroban).
//!
//! Escrows funds and records note commitments. Settlement is gated by a real
//! on-chain Groth16 proof (verified via a cross-contract call into the verifier)
//! and a one-time nullifier — so a payment can be settled exactly once.
//!
//! Trust model (gateway-managed, documented): Stellar has no on-chain Poseidon
//! host function yet, so the Merkle root is computed OFF-CHAIN by the operator
//! from this contract's on-chain commitment list (public, auditable). `settle` is
//! operator-gated; the operator only submits proofs whose roots it validated
//! off-chain. What is fully trustless on-chain: real escrow, the Groth16 proof
//! check, and single-use nullifiers (no double-settle, even by the operator).

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, BytesN,
    Env, Vec,
};

/// Groth16 proof points (uncompressed affine), matching the verifier contract.
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,  // G1
    pub b: BytesN<128>, // G2
    pub c: BytesN<64>,  // G1
}

/// Client for the deployed verifier contract — generated from this interface, so
/// the pool can cross-contract-call `verify` WITHOUT linking the verifier's
/// implementation (which would leak its exports into the pool wasm).
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify(env: Env, proof: Proof, public_inputs: Vec<BytesN<32>>) -> bool;
}

#[contracttype]
enum DataKey {
    Token,
    Verifier,
    Operator,
    Commitments,
    Nullifier(BytesN<32>),
}

#[contract]
pub struct Pool;

#[contractimpl]
impl Pool {
    /// Configure the pool. One-time.
    pub fn init(env: Env, token: Address, verifier: Address, operator: Address) {
        let s = env.storage().instance();
        if s.has(&DataKey::Token) {
            panic!("pool already initialized");
        }
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Verifier, &verifier);
        s.set(&DataKey::Operator, &operator);
        s.set(&DataKey::Commitments, &Vec::<BytesN<32>>::new(&env));
    }

    /// Escrow `amount` and record `commitment` as a new note leaf. Permissionless.
    /// Returns the leaf index. The operator builds the Merkle tree off-chain from
    /// these commitments (Poseidon), matching the circuit.
    pub fn deposit(env: Env, from: Address, commitment: BytesN<32>, amount: i128) -> u32 {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::TokenClient::new(&env, &token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let mut commitments: Vec<BytesN<32>> =
            env.storage().instance().get(&DataKey::Commitments).unwrap();
        let index = commitments.len();
        commitments.push_back(commitment.clone());
        env.storage().instance().set(&DataKey::Commitments, &commitments);

        env.events().publish((symbol_short!("deposit"), index), commitment);
        index
    }

    /// All note commitments, in deposit order — for off-chain Merkle-tree building.
    pub fn commitments(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&DataKey::Commitments)
            .unwrap_or(Vec::new(&env))
    }

    /// Whether a nullifier has already been settled.
    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    /// Operator settles one verified payment: check the Groth16 proof on-chain,
    /// spend the nullifier (public_inputs[0]) exactly once, pay `recipient`.
    pub fn settle(
        env: Env,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
        recipient: Address,
        amount: i128,
    ) {
        let s = env.storage().instance();
        let operator: Address = s.get(&DataKey::Operator).unwrap();
        operator.require_auth();

        // 1) cryptographic validity — runs the BN254 pairing in the verifier contract
        let verifier: Address = s.get(&DataKey::Verifier).unwrap();
        if !VerifierClient::new(&env, &verifier).verify(&proof, &public_inputs) {
            panic!("invalid proof");
        }

        // 2) single-use nullifier
        let nullifier = public_inputs.get(0).expect("missing nullifier");
        let key = DataKey::Nullifier(nullifier.clone());
        if env.storage().persistent().has(&key) {
            panic!("nullifier already spent");
        }
        env.storage().persistent().set(&key, &true);

        // 3) payout
        let token: Address = s.get(&DataKey::Token).unwrap();
        token::TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        env.events().publish((symbol_short!("settle"),), nullifier);
    }
}
