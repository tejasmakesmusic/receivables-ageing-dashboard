import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.105.190.42", "127.0.0.1", "localhost"],
  // @sentry/nextjs is an optional production dep — skip bundling locally
  serverExternalPackages: ["@sentry/nextjs"],
  async redirects() {
    return [
      { source: "/accounts", destination: "/parties", permanent: true },
      { source: "/accounts/:path*", destination: "/parties/:path*", permanent: true },
      { source: "/collections", destination: "/tasks", permanent: true },
      { source: "/collections/:path*", destination: "/tasks/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
