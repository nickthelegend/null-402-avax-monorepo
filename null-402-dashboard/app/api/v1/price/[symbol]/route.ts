import { build402, verifyPayment, gateConfig, PAYTO } from "@/lib/gateway/gate";

export const runtime = "edge";

const PRICE_QUOTE = 1_000; // 0.001 tier

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const { pathname } = new URL(req.url);

  const cfg = gateConfig(PRICE_QUOTE, `Real-time price for ${symbol}`);
  const outcome = await verifyPayment(
    { method: "GET", path: pathname, paymentHeader: req.headers.get("X-PAYMENT") },
    cfg,
  );

  if (!outcome.ok) {
    if (outcome.reason === "no-payment") {
      const r = build402({ requiredAmount: PRICE_QUOTE, payTo: PAYTO, description: `Real-time price for ${symbol}`, resource: pathname });
      return Response.json(r.body, { status: r.status, headers: r.headers });
    }
    return Response.json({ error: "payment-rejected", reason: outcome.reason }, { status: 402 });
  }

  const headers = {
    "X-Null402-Proof": outcome.result.proofRef,
    "X-Privacy": outcome.result.mode === "soroban" ? "zk-groth16" : "dev-scaffold",
    "X-Payment-Accepted": "true",
  };

  // REAL price from Coinbase's public spot endpoint (no API key). Not mocked.
  try {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`, {
      headers: { Accept: "application/json" },
    });
    const j = (await r.json()) as { data?: { amount?: string } };
    const price = Number(j?.data?.amount);
    if (!Number.isFinite(price)) throw new Error(`no price for ${symbol}`);
    return Response.json(
      { symbol, price, currency: "USD", source: "coinbase", asOf: new Date().toISOString(),
        _proof: outcome.result.proofRef, _privacy: outcome.result.mode },
      { headers },
    );
  } catch {
    return Response.json({ error: "upstream price unavailable", symbol }, { status: 502, headers });
  }
}
