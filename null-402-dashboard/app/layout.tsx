import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "null-402 — private pay-per-call on Stellar",
  description:
    "x402 with zero-knowledge payment proofs on Stellar. Verify payments without revealing the sender account, amount, or which API was accessed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
