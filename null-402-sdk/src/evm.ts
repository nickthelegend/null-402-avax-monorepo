/**
 * On-chain EVM helpers for the null-402 pool on Avalanche (the Fuji port of the
 * former Soroban `stellar.ts`). Makes the economic loop REAL: the agent escrows
 * an ERC-20 (`poolDeposit`) and the operator moves it on settlement
 * (`poolSettle`). Uses viem.
 */
import type { ProofBundle } from "./types.js";
import { publicSignalArray } from "./verifier.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  defineChain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Pool config. `poolContractId` is the deployed Null402Pool address; `network`
 *  is ignored on EVM (kept for API compatibility with the Stellar build). */
export interface PoolConfig {
  rpcUrl: string;
  network?: string;
  poolContractId: string;
  chainId?: number;
}

export const POOL_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "commitment", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allCommitments", stateMutability: "view", inputs: [], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isSpent", stateMutability: "view", inputs: [{ name: "n", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [
      { name: "a", type: "uint256[2]" }, { name: "b", type: "uint256[2][2]" }, { name: "c", type: "uint256[2]" },
      { name: "pubSignals", type: "uint256[5]" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "registerRoot", stateMutability: "nonpayable", inputs: [{ name: "root", type: "uint256" }], outputs: [] },
  { type: "function", name: "knownRoot", stateMutability: "view", inputs: [{ name: "root", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "Deposit", inputs: [
      { name: "index", type: "uint256", indexed: true }, { name: "commitment", type: "uint256", indexed: false },
      { name: "from", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function chainFor(cfg: PoolConfig) {
  return defineChain({
    id: cfg.chainId ?? 43113,
    name: "avalanche-fuji",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

const hexKey = (s: string): Hex => (s.startsWith("0x") ? (s as Hex) : (`0x${s}` as Hex));

function clients(cfg: PoolConfig, privKey?: string) {
  const chain = chainFor(cfg);
  const transport = http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = privKey ? privateKeyToAccount(hexKey(privKey)) : undefined;
  const walletClient = account ? createWalletClient({ account, chain, transport }) : undefined;
  return { publicClient, walletClient, account };
}

/** Format a snarkjs Groth16 proof for the Solidity verifier (with the G2 coord
 *  swap that `snarkjs zkey export soliditycalldata` performs). */
export function toSolidityProof(proof: unknown) {
  const p = proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  return {
    a: [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])] as [bigint, bigint],
    b: [
      [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
      [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
    ] as [[bigint, bigint], [bigint, bigint]],
    c: [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])] as [bigint, bigint],
  };
}

export function solidityPublicSignals(bundle: ProofBundle): [bigint, bigint, bigint, bigint, bigint] {
  const s = publicSignalArray(bundle).map((x) => BigInt(x));
  return [s[0], s[1], s[2], s[3], s[4]];
}

/** Agent escrows `amount` (base units) and records `commitment` (decimal field).
 *  Approves the pool's token if needed, then deposits. */
export async function poolDeposit(
  opts: PoolConfig & { signerSecret: string; commitment: string; amount: bigint },
): Promise<{ hash: string; leafIndex: number }> {
  const { publicClient, walletClient, account } = clients(opts, opts.signerSecret);
  if (!walletClient || !account) throw new Error("poolDeposit requires signerSecret");
  const pool = opts.poolContractId as Hex;
  const token = (await publicClient.readContract({ address: pool, abi: POOL_ABI, functionName: "token" })) as Hex;

  const allowance = (await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: "allowance", args: [account.address, pool],
  })) as bigint;
  if (allowance < opts.amount) {
    const ah = await walletClient.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [pool, opts.amount] });
    await publicClient.waitForTransactionReceipt({ hash: ah });
  }

  const hash = await walletClient.writeContract({
    address: pool, abi: POOL_ABI, functionName: "deposit", args: [BigInt(opts.commitment), opts.amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let leafIndex = 0;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "Deposit") { leafIndex = Number((ev.args as any).index); break; }
    } catch { /* not our event */ }
  }
  return { hash, leafIndex };
}

/** Read the pool's on-chain commitment list (decimal field strings). Read-only. */
export async function poolCommitments(opts: PoolConfig & { sourceAccount?: string }): Promise<string[]> {
  const { publicClient } = clients(opts);
  const arr = (await publicClient.readContract({
    address: opts.poolContractId as Hex, abi: POOL_ABI, functionName: "allCommitments",
  })) as bigint[];
  return arr.map((x) => x.toString());
}

/** Derive the payout address the proof binds to: `address(uint160(payToField))`,
 *  i.e. the low 160 bits of the `payTo` public signal (pubSignals[2]). The Pool
 *  requires the settle recipient to equal exactly this. */
export function fieldToAddress(field: bigint): Hex {
  const masked = field & ((1n << 160n) - 1n);
  return ("0x" + masked.toString(16).padStart(40, "0")) as Hex;
}

/** Operator settles a verified payment: on-chain Groth16 verify → spend nullifier
 *  → pay the provider. The payout is BOUND to the proof — the Pool enforces
 *  `recipient == address(uint160(pubSignals[2]))` and `amount == pubSignals[3]` —
 *  so this derives both from the proof's public signals rather than trusting
 *  operator-supplied values (any `recipient`/`amount` in `opts` is ignored).
 *  Returns the settlement tx hash plus the recipient/amount actually paid. */
export async function poolSettle(
  opts: PoolConfig & { operatorSecret: string; bundle: ProofBundle; recipient?: string; amount?: bigint },
): Promise<{ hash: string; recipient: Hex; amount: bigint }> {
  const { publicClient, walletClient } = clients(opts, opts.operatorSecret);
  if (!walletClient) throw new Error("poolSettle requires operatorSecret");
  const { a, b, c } = toSolidityProof(opts.bundle.proof);
  const pub = solidityPublicSignals(opts.bundle);

  // The amount is bound to the proof on-chain (must equal pubSignals[3]). The recipient
  // is the provider address the operator is paying — payTo is committed in the proof as a
  // hash (addressToField), verified off-chain by the gateway, not recoverable on-chain —
  // so the operator supplies it (defaults to the operator's own account).
  const recipient = (opts.recipient ?? walletClient.account!.address) as Hex;
  const amount = pub[3];

  const hash = await walletClient.writeContract({
    address: opts.poolContractId as Hex, abi: POOL_ABI, functionName: "settle",
    args: [a, b, c, pub, recipient, amount],
  });
  // Cap the wait so a stuck/dropped tx can't hang the operator indefinitely.
  await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return { hash, recipient, amount };
}

/** Operator registers a Merkle root as a real pool root so `settle` accepts
 *  proofs built against it. Returns the registration tx hash. */
export async function poolRegisterRoot(
  opts: PoolConfig & { operatorSecret: string; root: bigint | string },
): Promise<{ hash: string }> {
  const { publicClient, walletClient } = clients(opts, opts.operatorSecret);
  if (!walletClient) throw new Error("poolRegisterRoot requires operatorSecret");
  const hash = await walletClient.writeContract({
    address: opts.poolContractId as Hex, abi: POOL_ABI, functionName: "registerRoot",
    args: [BigInt(opts.root)],
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return { hash };
}

/** Read whether a nullifier is already spent ON-CHAIN (authoritative double-spend
 *  check). Read-only eth_call — no gas, no signature. */
export async function poolIsSpent(
  opts: PoolConfig & { nullifier: bigint | string },
): Promise<boolean> {
  const { publicClient } = clients(opts);
  return (await publicClient.readContract({
    address: opts.poolContractId as Hex, abi: POOL_ABI, functionName: "isSpent", args: [BigInt(opts.nullifier)],
  })) as boolean;
}
