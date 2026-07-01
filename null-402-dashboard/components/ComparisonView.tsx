"use client";

import { useState, useCallback, useEffect } from "react";
import type { DemoTriggerResponse, FeedEntry } from "@/lib/types";
import { PrivacyProof } from "./PrivacyProof";

// Empty string → all fetch calls use relative URLs (/api/…), same origin, zero CORS.
const GATEWAY_URL = "";

function PublicFeedRow({ entry }: { entry: FeedEntry & { type: "public" } }) {
  const tx = entry.data as DemoTriggerResponse["publicObservable"];
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700 text-xs space-y-1">
      <div className="flex justify-between items-start">
        <span className="text-slate-400">Tx hash</span>
        <span className="font-mono text-amber-300 max-w-[180px] truncate">{tx.txHash}</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">Sender</span>
        <span className="font-mono text-red-400 max-w-[180px] truncate">{tx.sender}</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">Amount</span>
        <span className="font-mono text-orange-300">{tx.amount}</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">Endpoint</span>
        <span className="font-mono text-orange-300">{tx.endpoint}</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">Time</span>
        <span className="text-slate-300">{new Date(tx.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="mt-1 pt-1 border-t border-slate-700 text-red-400 flex items-center gap-1">
        <span>⚠</span>
        <span>All data visible on-chain to anyone</span>
      </div>
    </div>
  );
}

function PrivateFeedRow({ entry }: { entry: FeedEntry & { type: "private" } }) {
  const v = entry.data as DemoTriggerResponse["privateVerified"];
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-violet-800 text-xs space-y-1">
      <div className="flex justify-between items-start">
        <span className="text-slate-400">payment_valid</span>
        <span className="font-mono text-emerald-400 font-bold">{String(v.payment_valid)}</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">sender</span>
        <span className="font-mono text-slate-500 italic">HIDDEN</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">amount</span>
        <span className="font-mono text-slate-500 italic">HIDDEN</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">endpoint</span>
        <span className="font-mono text-slate-500 italic">HIDDEN</span>
      </div>
      <div className="flex justify-between items-start">
        <span className="text-slate-400">nullifier</span>
        <span className="font-mono text-violet-400 max-w-[180px] truncate">{v.nullifier}</span>
      </div>
      <div className="mt-1 pt-1 border-t border-violet-800 text-emerald-400 flex items-center gap-1">
        <span>🔒</span>
        <span>Only a nullifier + valid boolean ever touch the chain</span>
      </div>
    </div>
  );
}

export function ComparisonView() {
  const [publicFeed, setPublicFeed] = useState<(FeedEntry & { type: "public" })[]>([]);
  const [privateFeed, setPrivateFeed] = useState<(FeedEntry & { type: "private" })[]>([]);
  const [latestVerification, setLatestVerification] = useState<DemoTriggerResponse["privateVerified"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerPayment = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${GATEWAY_URL}/api/demo/trigger`, { method: "POST" });
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);

      const data = (await res.json()) as DemoTriggerResponse;
      const id = crypto.randomUUID();
      const receivedAt = new Date().toISOString();

      setPublicFeed((prev) => [
        { id: `pub-${id}`, type: "public", data: data.publicObservable, receivedAt },
        ...prev.slice(0, 4),
      ]);

      setPrivateFeed((prev) => [
        { id: `prv-${id}`, type: "private", data: data.privateVerified, receivedAt },
        ...prev.slice(0, 4),
      ]);

      setLatestVerification(data.privateVerified);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-trigger on mount for demo warmup.
  useEffect(() => {
    triggerPayment();
  }, [triggerPayment]);

  return (
    <div className="flex flex-col gap-8">
      {/* Trigger button */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={triggerPayment}
          disabled={loading}
          className={[
            "px-8 py-3 rounded-xl font-semibold text-sm transition-all",
            loading
              ? "bg-slate-700 text-slate-400 cursor-wait"
              : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/50",
          ].join(" ")}
        >
          {loading ? "⏳ Verifying proof…" : "⚡ Trigger Private Payment"}
        </button>
        {error && (
          <p className="text-red-400 text-xs">
            {error} — is the gateway reachable?
          </p>
        )}
        <p className="text-xs text-slate-500">
          Fires one payment through both flows so you can compare what leaks
        </p>
      </div>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Standard x402 (public) */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-slate-200">
              Standard x402 — Public On-Chain
            </h2>
          </div>
          <div className="p-3 bg-red-950 border border-red-800 rounded-lg text-xs text-red-300">
            Everything below is visible to any block explorer, indexer, or
            competitor scraping on-chain data.
          </div>
          <div className="flex flex-col gap-3">
            {publicFeed.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-6">
                No payments yet — trigger one above
              </div>
            )}
            {publicFeed.map((entry) => (
              <PublicFeedRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>

        {/* Right — null-402 */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-slate-200">
              null-402 — Zero-Knowledge on Avalanche
            </h2>
          </div>
          <div className="p-3 bg-violet-950 border border-violet-800 rounded-lg text-xs text-violet-300">
            The client proves payment validity with a Groth16 proof verified on
            Stellar. Only a nullifier and a valid boolean are ever revealed —
            sender, amount, and endpoint never leave the client.
          </div>
          <div className="flex flex-col gap-3">
            {privateFeed.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-6">
                No verifications yet — trigger a payment above
              </div>
            )}
            {privateFeed.map((entry) => (
              <PrivateFeedRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </div>

      {/* Privacy proof detail */}
      <div className="border border-slate-700 rounded-xl p-6 bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">
          Latest Proof Verification Detail
        </h3>
        <PrivacyProof verification={latestVerification} />
      </div>
    </div>
  );
}
