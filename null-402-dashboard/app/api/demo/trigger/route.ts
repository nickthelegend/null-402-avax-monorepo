export const runtime = "edge";

const PRICE_QUOTE = 1_000; // 0.001 tier (base units)

export async function POST(): Promise<Response> {
  const txHash = `PUBLIC_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // What a *public* x402 payment leaks to any chain observer.
  const publicObservable = {
    txHash,
    sender: "0x86076053d71E1c95b3c08e68BA39049024D69E67", // demo account
    recipient: process.env.PAYMENT_PAYTO ?? "G_DEMO_GATEWAY_ACCOUNT",
    amount: `${PRICE_QUOTE / 1_000_000} nUSD`,
    endpoint: "/v1/price/BTC",
    timestamp: new Date().toISOString(),
  };

  // What null-402 reveals: a nullifier + a valid boolean. Nothing else.
  const privateVerified = {
    payment_valid: true,
    sender: "[HIDDEN — never leaves the client]",
    amount: "[HIDDEN — proven ≥ price, exact value secret]",
    endpoint: "[HIDDEN — not logged by gateway]",
    nullifier: `nf_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
    proofRef: `groth16-bn254 · avalanche`,
    privacyMode: "evm" as const,
  };

  return Response.json({
    publicObservable,
    privateVerified,
    comparison: {
      publicExposes: ["sender account", "exact amount", "API endpoint", "timestamp"],
      privateExposes: ["nullifier + valid boolean only"],
      hiddenByNull402: ["sender account", "exact amount", "API endpoint", "access frequency"],
    },
  });
}
