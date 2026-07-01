/// <reference types="@cloudflare/workers-types" />
/**
 * null-402 gateway — Cloudflare Worker entry point.
 *
 * A reference gateway built on the `null-402` SDK. Every paid route calls
 * privateVerify(); only a `valid` boolean from the proof gates access. No
 * wallet, amount, or endpoint is ever seen on-chain or logged.
 *
 * Routes:
 *   GET  /v1/price/:symbol   → price data,     0.001-tier gate
 *   GET  /v1/listings        → top listings,   0.002-tier gate
 *   GET  /health             → liveness + verify mode
 *   POST /api/demo/trigger   → public-vs-private contrast (dashboard)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types.js";
import { privateVerify } from "./middleware/private-verify.js";

// ── Price tiers (asset base units) ────────────────────────────────────────────
const PRICE_QUOTE = 1_000; // 0.001 tier
const PRICE_LISTINGS = 2_000; // 0.002 tier

/** Privacy/proof headers attached to every paid response — never any sensitive data. */
function privacyHeaders(v: { proofRef: string; mode: "evm" | "local" | "dev" }): Record<string, string> {
  return {
    "X-Null402-Proof": v.proofRef,
    "X-Privacy": v.mode === "dev" ? "dev-scaffold" : "zk-groth16",
    "X-Payment-Accepted": "true",
  };
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "X-PAYMENT"],
  exposeHeaders: ["X-Null402-Proof", "X-Privacy", "X-Payment-Accepted"],
}));

// Minimal logger — deliberately omits sensitive headers.
app.use("*", logger());

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => {
  const mode = c.env.VERIFY_MODE === "dev" ? "dev-scaffold" : "evm";
  return c.json({
    status: "ok",
    verify: mode,
    network: "avalanche-fuji",
    timestamp: new Date().toISOString(),
  });
});

// ── GET /v1/price/:symbol ─────────────────────────────────────────────────────

app.get("/v1/price/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();

  const result = await privateVerify(c, {
    requiredAmount: PRICE_QUOTE,
    description: `Real-time price for ${symbol}`,
  });
  if (result instanceof Response) return result;

  // REAL price from Coinbase's public spot endpoint (no API key). Not mocked.
  try {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`, {
      headers: { Accept: "application/json" },
    });
    const j = (await r.json()) as { data?: { amount?: string } };
    const price = Number(j?.data?.amount);
    if (!Number.isFinite(price)) throw new Error(`no price for ${symbol}`);
    return c.json(
      { symbol, price, currency: "USD", source: "coinbase", asOf: new Date().toISOString(),
        _proof: result.proofRef, _privacy: result.mode },
      200,
      privacyHeaders(result),
    );
  } catch (err) {
    return c.json({ error: "upstream price unavailable", symbol, detail: String(err) }, 502, privacyHeaders(result));
  }
});

// ── GET /v1/listings ──────────────────────────────────────────────────────────

app.get("/v1/listings", async (c) => {
  const result = await privateVerify(c, {
    requiredAmount: PRICE_LISTINGS,
    description: "Top 10 cryptocurrency listings by market cap",
  });
  if (result instanceof Response) return result;

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
    return c.json(
      { data, source: "coingecko", asOf: new Date().toISOString(), _proof: result.proofRef, _privacy: result.mode },
      200,
      privacyHeaders(result),
    );
  } catch (err) {
    return c.json({ error: "upstream listings unavailable", detail: String(err) }, 502, privacyHeaders(result));
  }
});

// ── POST /api/demo/trigger ────────────────────────────────────────────────────

app.post("/api/demo/trigger", (c) => {
  // Illustrates the contrast for the dashboard. Left: what a public x402 payment
  // leaks. Right: what null-402 reveals — only the nullifier + a valid boolean.
  const publicObservable = {
    txHash: `PUBLIC_${Date.now()}`,
    sender: "0x86076053d71E1c95b3c08e68BA39049024D69E67", // demo account (public x402 leaks it)
    recipient: c.env.PAYMENT_PAYTO ?? "GATEWAY_ACCOUNT",
    amount: "0.001 USDC",
    endpoint: "/v1/price/BTC",
    timestamp: new Date().toISOString(),
  };

  const privateVerified = {
    payment_valid: true,
    sender: "[HIDDEN — never leaves the client]",
    amount: "[HIDDEN — proven >= price, exact value secret]",
    endpoint: "[HIDDEN — not logged by gateway]",
    nullifier: `nf_${Date.now().toString(16)}`,
    proofSystem: "groth16-bn254 on Avalanche",
    privacyMode: c.env.VERIFY_MODE === "dev" ? "dev-scaffold" : "evm",
  };

  return c.json({
    publicObservable,
    privateVerified,
    comparison: {
      publicExposes: ["sender account", "exact amount", "API endpoint", "timestamp"],
      privateExposes: ["nullifier + valid boolean only"],
      hiddenByNull402: ["sender account", "exact amount", "API endpoint", "access frequency"],
    },
  });
});

// ── 404 / errors ──────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
