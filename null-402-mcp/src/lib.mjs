/**
 * null-402 MCP — core tool logic (wallet + private payments) on Avalanche.
 * Used by the MCP server (index.mjs), the self-test, and the Groq agent.
 *
 * A persistent wallet (an EVM key + its private notes) is stored as JSON. Notes
 * are spent by generating a real Groth16 proof and paying an x402 endpoint —
 * only a nullifier is ever revealed on-chain.
 *
 * Testability: `createHandlers(deps)` builds the four tool handlers with every
 * chain-facing dependency (publicClient, a wallet-client factory, the pool
 * deposit/commitments calls, the Null402Client, and fetch) injectable. The
 * module-level `createWallet`/`walletStatus`/`deposit`/`pay` exports below are
 * just `createHandlers()` called with the production defaults, so index.mjs and
 * selftest.mjs keep working unchanged.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, defineChain, parseEther, formatEther, formatUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  Null402Client, groth16Prover, noteCommitment, buildPoolWitness, encodePayment,
  poolDeposit, poolCommitments, randomField,
} from "null-402";

const HERE = dirname(fileURLToPath(import.meta.url));

export const config = {
  rpcUrl: process.env.NULL402_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc",
  chainId: Number(process.env.NULL402_CHAIN_ID ?? 43113),
  poolContractId: process.env.NULL402_POOL ?? "0x3f528ab5A5e258f75692A3A9F4441D1E54eBB511",
  verifierContractId: process.env.NULL402_VERIFIER ?? "0x0b44836dDc460f589ce4EB97f276e533A2bE6060",
  token: process.env.NULL402_TOKEN ?? "0xabea27277b0189c4C054020Ea609060A9292Ee9C",
  // Optional funder (operator) key: tops up new agent wallets with a little AVAX
  // for gas (the "faucet"). nUSD is self-minted (open faucet).
  funderKey: process.env.NULL402_FUNDER_KEY ?? process.env.NULL402_OPERATOR_KEY ?? "",
  wasmPath: process.env.NULL402_WASM ?? join(HERE, "../../null-402-circuits/build/payment_js/payment.wasm"),
  zkeyPath: process.env.NULL402_ZKEY ?? join(HERE, "../../null-402-circuits/build/payment.zkey"),
  walletPath: process.env.NULL402_WALLET ?? join(homedir(), ".null-402", "wallet.json"),
};

export const ERC20_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

export const explorer = (h) => `https://testnet.snowtrace.io/tx/${h}`;
export const hexKey = (s) => (s.startsWith("0x") ? s : `0x${s}`);

/** Fixed note denomination (1 nUSD, 7 decimals). Uniform notes → exact
 *  settlement and the operator never learns a per-note amount. */
export const DENOM = 10_000_000n;

function defaultChain(cfg) {
  return defineChain({
    id: cfg.chainId, name: "avalanche-fuji",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

/**
 * Build the four MCP tool handlers with every chain-facing dependency
 * injectable. Defaults reproduce production behavior exactly (real viem
 * clients against `cfg`, the real groth16 prover, the real SDK pool calls,
 * global fetch).
 */
export function createHandlers(deps = {}) {
  const cfg = deps.config ?? config;
  const chain = deps.chain ?? defaultChain(cfg);
  const walletPath = deps.walletPath ?? cfg.walletPath;

  const publicClient = deps.publicClient ?? createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  // Wallet-client factory: given a private key, return a viem WalletClient.
  const walletFor = deps.walletFor ?? ((privateKey) => {
    const account = privateKeyToAccount(hexKey(privateKey));
    return createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  });

  const client = deps.client ?? new Null402Client({
    prover: groth16Prover({ wasmPath: cfg.wasmPath, zkeyPath: cfg.zkeyPath }),
  });
  const poolCfg = { rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, poolContractId: cfg.poolContractId };

  // SDK's on-chain pool helpers (viem-backed) — injectable for tests.
  const doPoolDeposit = deps.poolDeposit ?? poolDeposit;
  const doPoolCommitments = deps.poolCommitments ?? poolCommitments;
  const doFetch = deps.fetch ?? fetch;

  function load() {
    return existsSync(walletPath) ? JSON.parse(readFileSync(walletPath, "utf8")) : null;
  }
  function save(w) {
    mkdirSync(dirname(walletPath), { recursive: true });
    writeFileSync(walletPath, JSON.stringify(w, null, 2));
  }

  async function createWallet() {
    let w = load();
    if (w?.privateKey) return `Wallet already exists:\n  ${w.address}`;
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;

    // Fund gas from the operator/funder (Fuji AVAX), if configured.
    let funded;
    if (cfg.funderKey) {
      try {
        const funder = walletFor(cfg.funderKey);
        const hash = await funder.sendTransaction({ to: address, value: parseEther("0.05") });
        await publicClient.waitForTransactionReceipt({ hash });
        funded = " (funded 0.05 AVAX for gas)";
      } catch (e) {
        funded = ` (auto-fund failed: ${String(e).slice(0, 80)} — send Fuji AVAX to the address)`;
      }
    } else {
      funded = " (set NULL402_FUNDER_KEY or send Fuji AVAX to the address for gas)";
    }

    w = { privateKey, address, notes: [] };
    save(w);
    return `Created an Avalanche Fuji wallet${funded}:\n  ${address}`;
  }

  async function walletStatus() {
    const w = load();
    if (!w) return "No wallet yet — call create_wallet.";
    const avax = await publicClient.getBalance({ address: w.address }).then(formatEther).catch(() => "?");
    const nusd = await publicClient
      .readContract({ address: cfg.token, abi: ERC20_ABI, functionName: "balanceOf", args: [w.address] })
      .then((v) => formatUnits(v, 7))
      .catch(() => "?");
    const unspent = w.notes.filter((n) => !n.spent).length;
    return `Wallet ${w.address}\n  AVAX (gas): ${avax}\n  nUSD: ${nusd}\n  Notes: ${w.notes.length} (${unspent} unspent / spendable)`;
  }

  async function deposit() {
    const w = load();
    if (!w) throw new Error("No wallet — call create_wallet first.");

    // Self-mint the escrow amount (nUSD open faucet), then escrow it into the pool.
    const wallet = walletFor(w.privateKey);
    const mintHash = await wallet.writeContract({ address: cfg.token, abi: ERC20_ABI, functionName: "mint", args: [w.address, DENOM] });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    // Note secrets are minted here (not via Null402Client.deposit(), which now
    // signs its own on-chain escrow tx) because this wallet's own key — not the
    // shared prover `client` — is the signer for the Pool deposit below.
    const note = { secret: randomField(), nullifierSecret: randomField(), value: DENOM };
    const commitment = await noteCommitment(note);

    // The mint above already moved DENOM nUSD into this wallet. If the pool escrow
    // now fails, those funds are NOT lost, but they are also NOT escrowed and no
    // note exists — surface that explicitly instead of failing silently with a
    // raw viem error, so the caller knows the mint/deposit are out of sync.
    let dep;
    try {
      dep = await doPoolDeposit({ ...poolCfg, signerSecret: w.privateKey, commitment, amount: DENOM });
    } catch (e) {
      throw new Error(
        `Escrow deposit FAILED after minting ${DENOM} nUSD to ${w.address}: those funds are in your ` +
        `wallet but were not escrowed into the pool and no note was recorded. Re-run deposit to retry. ` +
        `Cause: ${e?.message ?? e}`,
      );
    }

    // Store only the leaf index — the Merkle path is rebuilt at pay time against
    // the CURRENT shared pool tree, so every note proves membership in one tree.
    w.notes.push({
      secret: note.secret, nullifierSecret: note.nullifierSecret, value: DENOM.toString(),
      commitment, leafIndex: dep.leafIndex, spent: false, depositTx: dep.hash,
    });
    save(w);
    return `Deposited a 1-nUSD note into the pool (fixed denomination).\n  deposit tx: ${dep.hash}\n  ${explorer(dep.hash)}`;
  }

  async function pay({ url }) {
    const w = load();
    if (!w) throw new Error("No wallet — call create_wallet first.");
    const note = w.notes.find((n) => !n.spent);
    if (!note) throw new Error("No unspent notes — call deposit first.");

    // Rebuild the Merkle path against the CURRENT shared pool tree (real anonymity:
    // the proof references the same root as every other note in the pool).
    const commitments = await doPoolCommitments({ ...poolCfg });
    const wit = await buildPoolWitness(commitments, note.leafIndex);

    const probe = await doFetch(url);
    if (probe.status !== 402) return `Endpoint did not require payment (HTTP ${probe.status}).`;
    const accept = (await probe.json()).accepts?.[0];
    if (!accept) throw new Error("402 response missing payment terms");

    const u = new URL(url);
    const bundle = await client.prove({
      note: { secret: note.secret, nullifierSecret: note.nullifierSecret, value: BigInt(note.value) },
      merkleRoot: wit.merkleRoot, payTo: accept.payTo, requiredAmount: accept.maxAmountRequired,
      request: { method: "GET", path: u.pathname }, pathElements: wit.pathElements, pathIndices: wit.pathIndices,
    });
    const res = await doFetch(url, { headers: { "X-PAYMENT": encodePayment(bundle) } });
    const body = await res.text();
    const settleTx = res.headers.get("X-Settle-Tx");
    const settleErr = res.headers.get("X-Settle-Error");
    // Only burn the note locally when the gateway both accepted (HTTP 200) AND did
    // not report a settle error. A 200 that carries X-Settle-Error means access
    // was granted but on-chain settlement did NOT happen — keep the note spendable
    // so it isn't silently lost.
    if (res.status === 200 && !settleErr) {
      note.spent = true;
      if (settleTx) note.settleTx = settleTx;
      save(w);
    }

    return [
      `Paid privately — HTTP ${res.status}, X-Privacy=${res.headers.get("X-Privacy") ?? "?"}.`,
      `  The only thing revealed on-chain: nullifier ${bundle.publicSignals.nullifier.slice(0, 24)}…`,
      settleTx
        ? `  settled on-chain (1 nUSD → provider): ${settleTx}\n  ${explorer(settleTx)}`
        : settleErr
          ? `  (settlement skipped: ${settleErr})`
          : `  (verify-only; no operator settlement configured)`,
      `  API response: ${body}`,
    ].join("\n");
  }

  return { createWallet, walletStatus, deposit, pay, load, save, publicClient, walletFor, client };
}

// ── Production singletons (unchanged public API for index.mjs / selftest.mjs) ──

const defaultHandlers = createHandlers();

export const createWallet = defaultHandlers.createWallet;
export const walletStatus = defaultHandlers.walletStatus;
export const deposit = defaultHandlers.deposit;
export const pay = defaultHandlers.pay;
