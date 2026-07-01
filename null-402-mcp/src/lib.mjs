/**
 * null-402 MCP — core tool logic (wallet + private payments) on Avalanche.
 * Used by the MCP server (index.mjs), the self-test, and the Groq agent.
 *
 * A persistent wallet (an EVM key + its private notes) is stored as JSON. Notes
 * are spent by generating a real Groth16 proof and paying an x402 endpoint —
 * only a nullifier is ever revealed on-chain.
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
  poolDeposit, poolCommitments,
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

const chain = defineChain({
  id: config.chainId, name: "avalanche-fuji",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const client = new Null402Client({ prover: groth16Prover({ wasmPath: config.wasmPath, zkeyPath: config.zkeyPath }) });
const cfg = { rpcUrl: config.rpcUrl, chainId: config.chainId, poolContractId: config.poolContractId };

const ERC20_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const explorer = (h) => `https://testnet.snowtrace.io/tx/${h}`;
const hexKey = (s) => (s.startsWith("0x") ? s : `0x${s}`);

function load() {
  return existsSync(config.walletPath) ? JSON.parse(readFileSync(config.walletPath, "utf8")) : null;
}
function save(w) {
  mkdirSync(dirname(config.walletPath), { recursive: true });
  writeFileSync(config.walletPath, JSON.stringify(w, null, 2));
}
function walletFor(privateKey) {
  const account = privateKeyToAccount(hexKey(privateKey));
  return createWalletClient({ account, chain, transport: http(config.rpcUrl) });
}

export async function createWallet() {
  let w = load();
  if (w?.privateKey) return `Wallet already exists:\n  ${w.address}`;
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;

  // Fund gas from the operator/funder (Fuji AVAX), if configured.
  let funded;
  if (config.funderKey) {
    try {
      const funder = walletFor(config.funderKey);
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

export async function walletStatus() {
  const w = load();
  if (!w) return "No wallet yet — call create_wallet.";
  const avax = await publicClient.getBalance({ address: w.address }).then(formatEther).catch(() => "?");
  const nusd = await publicClient
    .readContract({ address: config.token, abi: ERC20_ABI, functionName: "balanceOf", args: [w.address] })
    .then((v) => formatUnits(v, 7))
    .catch(() => "?");
  const unspent = w.notes.filter((n) => !n.spent).length;
  return `Wallet ${w.address}\n  AVAX (gas): ${avax}\n  nUSD: ${nusd}\n  Notes: ${w.notes.length} (${unspent} unspent / spendable)`;
}

/** Fixed note denomination (1 nUSD, 7 decimals). Uniform notes → exact
 *  settlement and the operator never learns a per-note amount. */
export const DENOM = 10_000_000n;

export async function deposit() {
  const w = load();
  if (!w) throw new Error("No wallet — call create_wallet first.");

  // Self-mint the escrow amount (nUSD open faucet), then escrow it into the pool.
  const wallet = walletFor(w.privateKey);
  const mintHash = await wallet.writeContract({ address: config.token, abi: ERC20_ABI, functionName: "mint", args: [w.address, DENOM] });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const note = await client.deposit(DENOM);
  const commitment = await noteCommitment(note);
  const dep = await poolDeposit({ ...cfg, signerSecret: w.privateKey, commitment, amount: DENOM });

  // Store only the leaf index — the Merkle path is rebuilt at pay time against
  // the CURRENT shared pool tree, so every note proves membership in one tree.
  w.notes.push({
    secret: note.secret, nullifierSecret: note.nullifierSecret, value: DENOM.toString(),
    commitment, leafIndex: dep.leafIndex, spent: false, depositTx: dep.hash,
  });
  save(w);
  return `Deposited a 1-nUSD note into the pool (fixed denomination).\n  deposit tx: ${dep.hash}\n  ${explorer(dep.hash)}`;
}

export async function pay({ url }) {
  const w = load();
  if (!w) throw new Error("No wallet — call create_wallet first.");
  const note = w.notes.find((n) => !n.spent);
  if (!note) throw new Error("No unspent notes — call deposit first.");

  // Rebuild the Merkle path against the CURRENT shared pool tree (real anonymity:
  // the proof references the same root as every other note in the pool).
  const commitments = await poolCommitments({ ...cfg });
  const wit = await buildPoolWitness(commitments, note.leafIndex);

  const probe = await fetch(url);
  if (probe.status !== 402) return `Endpoint did not require payment (HTTP ${probe.status}).`;
  const accept = (await probe.json()).accepts?.[0];
  if (!accept) throw new Error("402 response missing payment terms");

  const u = new URL(url);
  const bundle = await client.prove({
    note: { secret: note.secret, nullifierSecret: note.nullifierSecret, value: BigInt(note.value) },
    merkleRoot: wit.merkleRoot, payTo: accept.payTo, requiredAmount: accept.maxAmountRequired,
    request: { method: "GET", path: u.pathname }, pathElements: wit.pathElements, pathIndices: wit.pathIndices,
  });
  const res = await fetch(url, { headers: { "X-PAYMENT": encodePayment(bundle) } });
  const body = await res.text();
  const settleTx = res.headers.get("X-Settle-Tx");
  const settleErr = res.headers.get("X-Settle-Error");
  if (res.status === 200) {
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
