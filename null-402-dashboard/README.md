# null-402-dashboard

Live demo for **null-402** — shows a standard (public) x402 payment next to a
private null-402 payment, side by side, so you can see exactly what leaks.

Built with Next.js 15 + React 19 + Tailwind. It embeds the
[`null-402`](../null-402-sdk) SDK as Next API routes, so it runs self-contained
(no separate gateway, no CORS) and deploys to Vercel on its own.

```bash
npm install                  # pulls the SDK via file:../null-402-sdk
cp .env.example .env.local
npm run dev                  # → http://localhost:3000
```

Leave `NEXT_PUBLIC_GATEWAY_URL` blank to use the embedded routes, or point it at a
deployed [`null-402-gateway`](../null-402-gateway) Worker.

> Phase 1 uses the SDK's dev verifier. Flip to the real Soroban verifier once
> `null-402-contracts` is deployed.
