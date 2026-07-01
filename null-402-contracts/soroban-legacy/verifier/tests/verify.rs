//! Host test: verify a REAL snarkjs-generated Groth16 proof inside the Soroban
//! environment (runs the actual BN254 pairing host function). This confirms both
//! the verification logic and the snarkjs→contract byte encoding.
//!
//! Fixture is generated from null-402-circuits:
//!   cd ../null-402-circuits && npm run build && node scripts/export-contract-inputs.mjs

use null402_verifier::{Proof, Verifier, VerifierClient, VerifyingKey};
use soroban_sdk::{BytesN, Env, Vec};

mod fixture;

fn load(env: &Env) -> (VerifierClient<'static>, VerifyingKey) {
    let id = env.register(Verifier, ());
    let client = VerifierClient::new(env, &id);

    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for p in fixture::IC.iter() {
        ic.push_back(BytesN::from_array(env, p));
    }
    let vk = VerifyingKey {
        alpha: BytesN::from_array(env, &fixture::ALPHA),
        beta: BytesN::from_array(env, &fixture::BETA),
        gamma: BytesN::from_array(env, &fixture::GAMMA),
        delta: BytesN::from_array(env, &fixture::DELTA),
        ic,
    };
    (client, vk)
}

fn proof(env: &Env) -> Proof {
    Proof {
        a: BytesN::from_array(env, &fixture::PROOF_A),
        b: BytesN::from_array(env, &fixture::PROOF_B),
        c: BytesN::from_array(env, &fixture::PROOF_C),
    }
}

fn public_inputs(env: &Env) -> Vec<BytesN<32>> {
    let mut v = Vec::new(env);
    for p in fixture::PUBLIC.iter() {
        v.push_back(BytesN::from_array(env, p));
    }
    v
}

#[test]
fn verifies_real_groth16_proof() {
    let env = Env::default();
    let (client, vk) = load(&env);
    client.init(&vk);
    assert!(
        client.verify(&proof(&env), &public_inputs(&env)),
        "a real snarkjs proof must verify on-chain"
    );
}

#[test]
fn rejects_tampered_public_input() {
    let env = Env::default();
    let (client, vk) = load(&env);
    client.init(&vk);

    let mut pubs = public_inputs(&env);
    let mut first = fixture::PUBLIC[0];
    first[31] ^= 0x01; // flip one bit of the nullifier
    pubs.set(0, BytesN::from_array(&env, &first));

    assert!(
        !client.verify(&proof(&env), &pubs),
        "a proof must not verify against tampered public inputs"
    );
}

#[test]
fn rejects_wrong_number_of_public_inputs() {
    let env = Env::default();
    let (client, vk) = load(&env);
    client.init(&vk);

    // 4 inputs instead of 5 → must be rejected, not verified
    let mut pubs = public_inputs(&env);
    pubs.pop_back();
    assert!(!client.verify(&proof(&env), &pubs));
}

#[test]
#[should_panic]
fn verify_before_init_panics() {
    let env = Env::default();
    let id = env.register(Verifier, ());
    let client = VerifierClient::new(&env, &id);
    // no init → the vk lookup fails
    client.verify(&proof(&env), &public_inputs(&env));
}

#[test]
#[should_panic(expected = "already initialized")]
fn init_twice_panics() {
    let env = Env::default();
    let (client, vk) = load(&env);
    client.init(&vk);
    client.init(&vk);
}
