"use client";

import type { PrivateVerification } from "@/lib/types";

interface Props {
  verification: PrivateVerification | null;
}

function Field({ label, value, hidden }: { label: string; value: string; hidden?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span
        className={[
          "font-mono text-sm px-2 py-1 rounded",
          hidden ? "bg-slate-800 text-slate-500 italic" : "bg-slate-900 text-emerald-400",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

export function PrivacyProof({ verification }: Props) {
  if (!verification) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        Waiting for verification…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Result badge */}
      <div className="flex items-center gap-3">
        <span
          className={[
            "text-2xl font-bold",
            verification.payment_valid ? "text-emerald-400" : "text-red-400",
          ].join(" ")}
        >
          {verification.payment_valid ? "✓ VALID" : "✗ INVALID"}
        </span>
        <span className="text-xs bg-violet-900 text-violet-300 px-2 py-0.5 rounded-full">
          {verification.privacyMode === "evm" ? "On-chain ZK · Avalanche" : "Dev scaffold"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Field label="payment_valid" value={String(verification.payment_valid)} />
        <Field label="sender_account" value={verification.sender} hidden />
        <Field label="transfer_amount" value={verification.amount} hidden />
        <Field label="api_endpoint" value={verification.endpoint} hidden />
        <Field label="nullifier (public)" value={verification.nullifier} />
      </div>

      {/* Groth16 proof */}
      <div className="mt-2 p-3 bg-violet-950 rounded-lg border border-violet-800">
        <p className="text-xs text-violet-400 uppercase tracking-wide mb-1">
          Groth16 proof — verified on Avalanche
        </p>
        <p className="font-mono text-xs text-violet-300 break-all">{verification.proofRef}</p>
      </div>

      {/* What's hidden */}
      <div className="p-3 bg-slate-800 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Hidden by the zero-knowledge proof:</p>
        <ul className="space-y-1">
          {["sender account", "exact payment amount", "API endpoint accessed", "access frequency"].map((item) => (
            <li key={item} className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-violet-400">🔒</span> {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
