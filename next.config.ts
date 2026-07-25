import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's engine is a native binary; keep it out of the bundler.
  serverExternalPackages: ["@prisma/client"],
  // Photo uploads go through a Route Handler, which has no body size limit of
  // its own. The cap lives in MAX_UPLOAD_BYTES and is enforced in the handler.
};

export default nextConfig;
