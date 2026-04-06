import './load-root-env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  /** Avoid broken webpack vendor-chunks for axios on the server (MODULE_NOT_FOUND ./vendor-chunks/axios@…). */
  serverExternalPackages: ['axios'],
  transpilePackages: ['@rentai/shared'],
  // API: `app/api/[[...path]]/route.ts` + `app/api/socket.io/route.ts` — REST only; Socket.IO client uses Nest origin (see resolve-socket-origin).
  async redirects() {
    return [
      {
        source: '/:locale/dashboard/settings/checklist-templates',
        destination: '/:locale/settings/checklist-templates',
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
