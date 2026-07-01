"use client";

/**
 * Real Groth16 proving — in the browser. Loads snarkjs + circomlibjs Poseidon
 * from a CDN (webpackIgnore keeps Next's bundler out of the way), builds a
 * private note + Merkle witness, and generates a real proof against the circuit
 * artifacts served from /circuit. Secrets are generated here and never leave.
 */

const SNARKJS = "https://cdn.jsdelivr.net/npm/snarkjs@0.7.5/+esm";
const CIRCOMLIBJS = "https://cdn.jsdelivr.net/npm/circomlibjs@0.1.7/+esm";
const LEVELS = 20;

function randField(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(31)); // < 2^248 < field modulus
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

export interface BrowserProof {
  proof: unknown;
  proveMs: number;
  signals: { nullifier: string; merkleRoot: string; payTo: string; requiredAmount: string; contextHash: string };
  secrets: { noteSecret: string; nullifierSecret: string; noteValue: string };
}

export async function proveInBrowser(onStep?: (s: string) => void): Promise<BrowserProof> {
  onStep?.("loading snarkjs + Poseidon…");
  const snarkjs: any = await import(/* webpackIgnore: true */ SNARKJS);
  const { buildPoseidon }: any = await import(/* webpackIgnore: true */ CIRCOMLIBJS);
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr: bigint[]): bigint => F.toObject(poseidon(arr));

  onStep?.("building a private note + Merkle witness…");
  const noteSecret = randField();
  const nullifierSecret = randField();
  const noteValue = 5000n;
  const commitment = H([noteSecret, nullifierSecret, noteValue]);
  const nullifier = H([nullifierSecret]);

  const zeros: bigint[] = [0n];
  for (let i = 1; i < LEVELS; i++) zeros.push(H([zeros[i - 1], zeros[i - 1]]));
  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let cur = commitment;
  for (let i = 0; i < LEVELS; i++) {
    pathElements.push(zeros[i].toString());
    pathIndices.push(0);
    cur = H([cur, zeros[i]]);
  }
  const merkleRoot = cur;
  const payTo = randField();
  const contextHash = randField();
  const requiredAmount = 1000n;

  const input = {
    noteSecret: noteSecret.toString(),
    nullifierSecret: nullifierSecret.toString(),
    noteValue: noteValue.toString(),
    pathElements,
    pathIndices,
    nullifier: nullifier.toString(),
    merkleRoot: merkleRoot.toString(),
    payTo: payTo.toString(),
    requiredAmount: requiredAmount.toString(),
    contextHash: contextHash.toString(),
  };

  onStep?.("generating the Groth16 proof in your browser…");
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/circuit/payment.wasm",
    "/circuit/payment.zkey",
  );
  const proveMs = Math.round(performance.now() - t0);

  return {
    proof,
    proveMs,
    signals: {
      nullifier: publicSignals[0],
      merkleRoot: publicSignals[1],
      payTo: publicSignals[2],
      requiredAmount: publicSignals[3],
      contextHash: publicSignals[4],
    },
    secrets: { noteSecret: noteSecret.toString(), nullifierSecret: nullifierSecret.toString(), noteValue: noteValue.toString() },
  };
}
