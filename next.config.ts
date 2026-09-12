import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js otherwise writes AGENTS.md and CLAUDE.md into the repo root on every
  // dev start, which is not part of this project.
  agentRules: false,
};

export default nextConfig;
