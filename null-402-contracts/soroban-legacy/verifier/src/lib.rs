#![no_std]
//! null-402 Groth16 verifier (Soroban).
//!
//! Verifies a Groth16 proof over BN254 against the null-402 payment circuit's
//! verifying key, using the BN254 pairing host functions (CAP-0074, soroban-sdk
//! 26.x). Returns a single boolean — the only thing that ever leaves verification.
//!
//! Check (product of pairings == 1, the form `pairing_check` expects):
//!   e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
//! where vk_x = IC[0] + Σ public_i · IC[i+1].
//!
//! The verifying key (exported from snarkjs `verification_key.json`) is stored
//! once via `init`. See null-402-circuits for the artifact + the converter.

use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

/// (r − 1) in the BN254 scalar field, big-endian. Multiplying a G1 point by this
/// scalar negates it (since r · P = 𝒪), giving −A for the pairing check.
const NEG_ONE_FR: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x00,
];

/// Groth16 proof points (uncompressed affine, snarkjs export order).
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,  // G1
    pub b: BytesN<128>, // G2
    pub c: BytesN<64>,  // G1
}

/// Circuit verifying key. `ic` has length `nPublic + 1` (here 6, for 5 signals).
#[contracttype]
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha: BytesN<64>,   // G1
    pub beta: BytesN<128>,   // G2
    pub gamma: BytesN<128>,  // G2
    pub delta: BytesN<128>,  // G2
    pub ic: Vec<BytesN<64>>, // G1[]
}

#[contracttype]
enum DataKey {
    Vk,
}

#[contract]
pub struct Verifier;

#[contractimpl]
impl Verifier {
    /// Store the circuit's verifying key. One-time.
    pub fn init(env: Env, vk: VerifyingKey) {
        if env.storage().instance().has(&DataKey::Vk) {
            panic!("verifier already initialized");
        }
        env.storage().instance().set(&DataKey::Vk, &vk);
    }

    /// Verify a Groth16 proof for `public_inputs` (Fr field elements, 32 bytes
    /// each, big-endian, in the circuit's public-signal order:
    /// nullifier, merkleRoot, payTo, requiredAmount, contextHash). Returns true
    /// iff the proof is valid.
    pub fn verify(env: Env, proof: Proof, public_inputs: Vec<BytesN<32>>) -> bool {
        let vk: VerifyingKey = env.storage().instance().get(&DataKey::Vk).unwrap();

        // public inputs must line up with IC (one IC point per input, plus IC[0]).
        if public_inputs.len() + 1 != vk.ic.len() {
            return false;
        }

        let bn = env.crypto().bn254();

        // vk_x = IC[0] + Σ public_i · IC[i+1]
        let mut ic = vk.ic.iter();
        let ic0 = Bn254G1Affine::from_bytes(ic.next().unwrap());
        let mut bases: Vec<Bn254G1Affine> = Vec::new(&env);
        for ic_point in ic {
            bases.push_back(Bn254G1Affine::from_bytes(ic_point));
        }
        let mut scalars: Vec<Bn254Fr> = Vec::new(&env);
        for pi in public_inputs.iter() {
            scalars.push_back(Bn254Fr::from_bytes(pi));
        }
        let vk_x = bn.g1_add(&ic0, &bn.g1_msm(bases, scalars));

        // −A = (r−1) · A
        let neg_one = Bn254Fr::from_bytes(BytesN::from_array(&env, &NEG_ONE_FR));
        let neg_a = bn.g1_mul(&Bn254G1Affine::from_bytes(proof.a), &neg_one);

        let g1 = vec![
            &env,
            neg_a,
            Bn254G1Affine::from_bytes(vk.alpha),
            vk_x,
            Bn254G1Affine::from_bytes(proof.c),
        ];
        let g2 = vec![
            &env,
            Bn254G2Affine::from_bytes(proof.b),
            Bn254G2Affine::from_bytes(vk.beta),
            Bn254G2Affine::from_bytes(vk.gamma),
            Bn254G2Affine::from_bytes(vk.delta),
        ];

        bn.pairing_check(g1, g2)
    }
}
