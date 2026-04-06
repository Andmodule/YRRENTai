import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Monorepo: NEXT_PUBLIC_* and API_* can live in repo root `.env` (same file as backend).
loadEnvConfig(path.join(__dirname, '..'));

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
