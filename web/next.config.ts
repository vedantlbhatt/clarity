import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Force Turbopack to treat this app directory as the root so it doesn't
    // jump to another lockfile higher in the filesystem.
    root: __dirname,
  },
};

export default nextConfig;
