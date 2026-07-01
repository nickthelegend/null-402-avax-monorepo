export const runtime = "edge";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    verify: process.env.VERIFY_MODE === "evm" ? "evm" : "dev-scaffold",
    network: process.env.EVM_CHAIN_ID ?? "avalanche-fuji-43113",
    timestamp: new Date().toISOString(),
  });
}
