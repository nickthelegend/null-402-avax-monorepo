import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["null-402"],
  // viem is resolved at runtime from
  // node_modules (the /api/verify route needs it for on-chain verification).
  serverExternalPackages: ["viem"],
};

export default nextConfig;
