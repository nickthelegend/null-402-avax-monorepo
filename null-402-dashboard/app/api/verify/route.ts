import { evmVerifier } from "null-402";

// viem needs Node APIs — not the edge runtime.
export const runtime = "nodejs";

const RPC = process.env.EVM_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
const VERIFIER = process.env.VERIFIER_CONTRACT_ID ?? "0x0b44836dDc460f589ce4EB97f276e533A2bE6060";
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID ?? 43113);

/** Verify a browser-generated Groth16 proof ON-CHAIN (Avalanche BN254 pairing via eth_call). */
export async function POST(req: Request): Promise<Response> {
  try {
    const { proof, publicSignals } = await req.json();
    const verifier = evmVerifier({ rpcUrl: RPC, verifierContractId: VERIFIER, chainId: CHAIN_ID });
    const valid = await verifier.verify({ proof, publicSignals });
    return Response.json({ valid, mode: "evm", verifier: VERIFIER });
  } catch (err) {
    return Response.json({ valid: false, error: (err as Error).message }, { status: 500 });
  }
}
