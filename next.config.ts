import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's engine is a native binary; keep it out of the bundler.
  serverExternalPackages: ["@prisma/client"],
  // Photo uploads go through a Route Handler, which has no body size limit of
  // its own. The cap lives in MAX_UPLOAD_BYTES and is enforced in the handler.

  // Next traces the runtime dependency graph and emits it as .next/standalone
  // — a self-contained server plus only the node_modules it actually uses,
  // instead of the whole tree. Irrelevant on the VPS, where npm install runs
  // once and node_modules just sits there; it matters for scripts/Dockerfile,
  // which builds a container meant to run on a free tier's 256MB.
  output: "standalone",
};

export default nextConfig;
