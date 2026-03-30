import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3010';

const nextConfig: NextConfig = {
  transpilePackages: ['@rentai/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
