import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js otherwise writes AGENTS.md and CLAUDE.md into the repo root on every
  // dev start, which is not part of this project.
  agentRules: false,
  // The dev server only trusts "localhost" for its HMR endpoint by default. Opening
  // the app on a LAN address or 127.0.0.1 (handy when testing on a phone) otherwise
  // gets the socket rejected, and the page never becomes interactive.
  allowedDevOrigins: [
    "127.0.0.1",
    "[::1]",
    "10.*.*.*",
    "172.*.*.*",
    "192.168.*.*",
  ],
};

export default nextConfig;
