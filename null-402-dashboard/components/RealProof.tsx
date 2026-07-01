"use client";

import { useState } from "react";
import { proveInBrowser, type BrowserProof } from "@/lib/prove";

type Result = BrowserProof & { valid: boolean; verifyMs: number };

export function RealProof() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const p = await proveInBrowser(setStep);
      setStep("verifying the proof on Avalanche testnet…");
      const t0 = performance.now();
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: p.proof, publicSignals: p.signals }),
      });
      const v = await res.json();
      setResult({ ...p, valid: !!v.valid, verifyMs: Math.round(performance.now() - t0) });
      setStep("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-violet-800 rounded-xl p-6 bg-slate-900">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Real ZK proof — generated in your browser</h3>
          <p className="text-xs text-slate-400 mt-1">
            snarkjs + the Circom circuit run client-side; the proof is then verified on the deployed Avalanche verifier.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className={[
            "px-6 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap",
            busy ? "bg-slate-700 text-slate-400 cursor-wait" : "bg-violet-600 hover:bg-violet-500 text-white",
          ].join(" ")}
        >
          {busy ? "⏳ proving…" : "⚡ Generate + verify real proof"}
        </button>
      </div>

      {step && <p className="text-xs text-violet-300 mt-4 animate-pulse">{step}</p>}
      {error && <p className="text-xs text-red-400 mt-4 break-all">⚠ {error}</p>}

      {result && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-lg font-bold ${result.valid ? "text-emerald-400" : "text-red-400"}`}>
                {result.valid ? "✓ VERIFIED ON-CHAIN" : "✗ INVALID"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              proved in <span className="text-slate-200 font-mono">{result.proveMs}ms</span> (browser) ·
              verified in <span className="text-slate-200 font-mono">{result.verifyMs}ms</span> (Avalanche Fuji)
            </p>
            <p className="text-[11px] text-slate-500 mt-3 uppercase tracking-wide">Revealed (public)</p>
            <Row k="nullifier" v={result.signals.nullifier} reveal />
            <Row k="merkleRoot" v={result.signals.merkleRoot} reveal />
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 mb-2 uppercase tracking-wide">Hidden (never left your browser)</p>
            <Row k="note secret" v={result.secrets.noteSecret} />
            <Row k="nullifier secret" v={result.secrets.nullifierSecret} />
            <Row k="exact value" v={result.secrets.noteValue} />
            <p className="text-[11px] text-emerald-400/80 mt-3">
              The verifier learned only a boolean — not who paid, how much, or which note.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, reveal }: { k: string; v: string; reveal?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 mt-1.5">
      <span className="text-xs text-slate-400">{k}</span>
      <span className={`font-mono text-xs max-w-[180px] truncate ${reveal ? "text-violet-300" : "text-slate-600 line-through"}`}>
        {v.length > 22 ? v.slice(0, 22) + "…" : v}
      </span>
    </div>
  );
}
