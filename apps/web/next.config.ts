import type { NextConfig } from "next";

const apiInternalUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${apiInternalUrl}/:path*` }];
  },
};

export default nextConfig;
