import { ComparisonView } from "@/components/ComparisonView";
import { RealProof } from "@/components/RealProof";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold">
              ∅
            </div>
            <span className="font-semibold text-slate-100">null-402</span>
            <span className="text-xs bg-violet-900 text-violet-300 px-2 py-0.5 rounded-full">
              ZK payments on Avalanche
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <a href="https://github.com/kato9292929/Arcium" className="hover:text-slate-200 transition-colors">
              GitHub
            </a>
            <a href="https://x402.org" className="hover:text-slate-200 transition-colors">
              x402 spec
            </a>
            <a href="https://build.avax.network" className="hover:text-slate-200 transition-colors">
              Avalanche privacy
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-12 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">
          API Payments. Nothing Leaks.
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto text-base">
          Standard x402 broadcasts who paid, how much, and which API they accessed.{" "}
          <strong className="text-slate-200">null-402</strong> replaces the payment with a
          zero-knowledge proof verified on Avalanche — only a single boolean and a one-time
          nullifier are ever revealed.
        </p>

        {/* Privacy guarantee chips */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {[
            { icon: "🔒", label: "Sender account hidden" },
            { icon: "🔒", label: "Amount hidden" },
            { icon: "🔒", label: "Endpoint hidden" },
            { icon: "🔒", label: "Access frequency hidden" },
            { icon: "✓", label: "Validity provable on-chain" },
          ].map(({ icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full text-xs text-slate-300"
            >
              <span>{icon}</span>
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-red-300 mb-2">Standard x402 (public)</h3>
            <code className="text-xs text-slate-300 block leading-relaxed">
              Agent → 402 →{" "}
              <span className="text-red-400">token transfer (visible on-chain)</span>{" "}
              → API access
            </code>
            <p className="text-xs text-slate-500 mt-2">
              Sender, amount, and endpoint are permanently visible to anyone indexing the
              chain.
            </p>
          </div>
          <div className="bg-violet-950/40 border border-violet-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-violet-300 mb-2">null-402 (private)</h3>
            <code className="text-xs text-slate-300 block leading-relaxed">
              Agent → 402 →{" "}
              <span className="text-violet-400">Groth16 proof verified on Avalanche</span>{" "}
              → API access
            </code>
            <p className="text-xs text-slate-500 mt-2">
              Only <code className="text-emerald-400">valid: true</code> + a nullifier are
              revealed. The proof is generated client-side; secrets never leave the device.
            </p>
          </div>
        </div>
      </section>

      {/* Live demo */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-100">Live Demo</h2>
          <p className="text-sm text-slate-400 mt-1">
            Generate a <strong className="text-slate-200">real</strong> zero-knowledge proof in your browser and verify
            it on Avalanche testnet — then compare what a public payment leaks vs. what null-402 reveals.
          </p>
        </div>
        <div className="mb-8">
          <RealProof />
        </div>
        <ComparisonView />
      </section>

      {/* Architecture */}
      <section className="border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <h2 className="text-lg font-semibold text-slate-100 mb-6">Architecture</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: "null-402 SDK",
                tech: "TypeScript · snarkjs",
                desc: "Drop-in server gate + client. Client generates a Groth16 proof locally; the gate verifies recipient, amount tier, request binding, and nullifier replay.",
              },
              {
                title: "Solidity contracts",
                tech: "Rust · BN254 · Poseidon",
                desc: "A shielded Pool (Poseidon Merkle tree of note commitments) and a Groth16 verifier. Only a boolean ever leaves verification.",
              },
              {
                title: "Avalanche + nUSD",
                tech: "Avalanche RPC",
                desc: "Settlement and proof verification. Replay prevention is keyed on the proof nullifier — never a wallet or tx — with a 24h TTL.",
              },
            ].map(({ title, tech, desc }) => (
              <div key={title} className="bg-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
                <p className="text-xs text-violet-400 mt-0.5 mb-2">{tech}</p>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        null-402 — private pay-per-call · Avalanche · Groth16 · Cloudflare Workers
      </footer>
    </main>
  );
}
