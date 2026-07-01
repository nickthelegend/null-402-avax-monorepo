import { build402, verifyPayment, gateConfig, PAYTO } from "@/lib/gateway/gate";

export const runtime = "edge";

const PRICE_LISTINGS = 2_000; // 0.002 tier

export async function GET(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  const cfg = gateConfig(PRICE_LISTINGS, "Top 10 cryptocurrency listings");
  const outcome = await verifyPayment(
    { method: "GET", path: pathname, paymentHeader: req.headers.get("X-PAYMENT") },
    cfg,
  );

  if (!outcome.ok) {
    if (outcome.reason === "no-payment") {
      const r = build402({ requiredAmount: PRICE_LISTINGS, payTo: PAYTO, description: "Top 10 cryptocurrency listings", resource: pathname });
      return Response.json(r.body, { status: r.status, headers: r.headers });
    }
    return Response.json({ error: "payment-rejected", reason: outcome.reason }, { status: 402 });
  }

  const headers = {
    "X-Null402-Proof": outcome.result.proofRef,
    "X-Privacy": outcome.result.mode === "soroban" ? "zk-groth16" : "dev-scaffold",
    "X-Payment-Accepted": "true",
  };

  // REAL top-10 by market cap from CoinGecko's public API (no key). Not mocked.
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1",
      { headers: { Accept: "application/json" } },
    );
    const arr = (await r.json()) as Array<{
      market_cap_rank: number; symbol: string; name: string; current_price: number; market_cap: number;
    }>;
    if (!Array.isArray(arr)) throw new Error("bad listings response");
    const data = arr.map((x) => ({
      rank: x.market_cap_rank, symbol: String(x.symbol).toUpperCase(), name: x.name,
      price: x.current_price, market_cap: x.market_cap,
    }));
    return Response.json(
      { data, source: "coingecko", asOf: new Date().toISOString(),
        _proof: outcome.result.proofRef, _privacy: outcome.result.mode },
      { headers },
    );
  } catch {
    return Response.json({ error: "upstream listings unavailable" }, { status: 502, headers });
  }
}
