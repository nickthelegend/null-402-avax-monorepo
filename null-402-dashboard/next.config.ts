import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["null-402"],
  // @stellar/stellar-sdk is heavy and uses Node APIs — resolve it at runtime from
  // node_modules (the /api/verify route needs it for on-chain verification).
  serverExternalPackages: ["@stellar/stellar-sdk"],
};

export default nextConfig;
