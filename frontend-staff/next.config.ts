import type { NextConfig } from 'next';

const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3010';

const nextConfig: NextConfig = {
  serverExternalPackages: ['axios'],
  transpilePackages: ['@rentai/shared'],
  experimental: {
    devtoolSegmentExplorer: false,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
