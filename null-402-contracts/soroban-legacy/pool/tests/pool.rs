//! Pool tests — unit (deposit / escrow / nullifier) + integration (settle does a
//! real cross-contract Groth16 verify against the verifier, with a real proof).
//!
//! Reuses the verifier's generated fixture (a real snarkjs proof). Generate it:
//!   cd ../../null-402-circuits && npm run build && node scripts/export-contract-inputs.mjs

use null402_pool::{Pool, PoolClient, Proof};
use null402_verifier::{Verifier, VerifierClient, VerifyingKey};
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, Vec};

#[path = "../../verifier/tests/fixture.rs"]
mod fixture;

fn deploy_verifier(env: &Env) -> Address {
    let id = env.register(Verifier, ());
    let c = VerifierClient::new(env, &id);
    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for p in fixture::IC.iter() {
        ic.push_back(BytesN::from_array(env, p));
    }
    c.init(&VerifyingKey {
        alpha: BytesN::from_array(env, &fixture::ALPHA),
        beta: BytesN::from_array(env, &fixture::BETA),
        gamma: BytesN::from_array(env, &fixture::GAMMA),
        delta: BytesN::from_array(env, &fixture::DELTA),
        ic,
    });
    id
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

fn nullifier(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &fixture::PUBLIC[0])
}

/// Deploy a SAC token + verifier + pool, return (env, pool client, token addr,
/// pool addr, operator). Auth is mocked.
struct Ctx {
    env: Env,
    token: Address,
    pool_id: Address,
    operator: Address,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let verifier = deploy_verifier(&env);
    let operator = Address::generate(&env);

    let pool_id = env.register(Pool, ());
    PoolClient::new(&env, &pool_id).init(&token, &verifier, &operator);

    Ctx { env, token, pool_id, operator }
}

#[test]
fn deposit_escrows_funds_and_records_commitment() {
    let ctx = setup();
    let pool = PoolClient::new(&ctx.env, &ctx.pool_id);
    let user = Address::generate(&ctx.env);
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&user, &1000);

    let commitment = BytesN::from_array(&ctx.env, &[7u8; 32]);
    let index = pool.deposit(&user, &commitment, &600);

    assert_eq!(index, 0);
    let tok = token::TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(tok.balance(&ctx.pool_id), 600);
    assert_eq!(tok.balance(&user), 400);

    let commits = pool.commitments();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits.get(0).unwrap(), commitment);
}

#[test]
fn deposits_increment_leaf_index() {
    let ctx = setup();
    let pool = PoolClient::new(&ctx.env, &ctx.pool_id);
    let user = Address::generate(&ctx.env);
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&user, &1000);

    assert_eq!(pool.deposit(&user, &BytesN::from_array(&ctx.env, &[1u8; 32]), &100), 0);
    assert_eq!(pool.deposit(&user, &BytesN::from_array(&ctx.env, &[2u8; 32]), &100), 1);
    assert_eq!(pool.commitments().len(), 2);
}

#[test]
fn settle_verifies_proof_pays_recipient_and_spends_nullifier() {
    let ctx = setup();
    let pool = PoolClient::new(&ctx.env, &ctx.pool_id);
    // fund the pool (stands in for accumulated deposits)
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&ctx.pool_id, &1000);

    let recipient = Address::generate(&ctx.env);
    assert!(!pool.is_spent(&nullifier(&ctx.env)));

    pool.settle(&proof(&ctx.env), &public_inputs(&ctx.env), &recipient, &1000);

    let tok = token::TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(tok.balance(&recipient), 1000);
    assert_eq!(tok.balance(&ctx.pool_id), 0);
    assert!(pool.is_spent(&nullifier(&ctx.env)));
}

#[test]
#[should_panic(expected = "nullifier already spent")]
fn settle_rejects_replay() {
    let ctx = setup();
    let pool = PoolClient::new(&ctx.env, &ctx.pool_id);
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&ctx.pool_id, &2000);
    let recipient = Address::generate(&ctx.env);

    pool.settle(&proof(&ctx.env), &public_inputs(&ctx.env), &recipient, &1000);
    // same nullifier again → must panic
    pool.settle(&proof(&ctx.env), &public_inputs(&ctx.env), &recipient, &1000);
}

#[test]
#[should_panic(expected = "invalid proof")]
fn settle_rejects_invalid_proof() {
    let ctx = setup();
    let pool = PoolClient::new(&ctx.env, &ctx.pool_id);
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&ctx.pool_id, &1000);
    let recipient = Address::generate(&ctx.env);

    // tamper one public input → the verifier returns false → settle panics
    let mut bad = public_inputs(&ctx.env);
    let mut first = fixture::PUBLIC[0];
    first[31] ^= 0x01;
    bad.set(0, BytesN::from_array(&ctx.env, &first));

    pool.settle(&proof(&ctx.env), &bad, &recipient, &1000);
}
