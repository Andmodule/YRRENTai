import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['axios'],
  transpilePackages: ['@rentai/shared'],
  experimental: {
    devtoolSegmentExplorer: false,
  },
  // API proxy: src/app/api/[[...path]]/route.ts (Node runtime fetch → Nest).
};

export default nextConfig;
