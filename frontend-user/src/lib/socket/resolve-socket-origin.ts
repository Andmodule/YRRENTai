import { resolveSocketBaseUrlFromEnv } from '@rentai/shared';

/**
 * Browser entry: env from Next `NEXT_PUBLIC_*` at build time.
 */
export function resolveSocketBaseUrl(): string {
  return resolveSocketBaseUrlFromEnv({
    wsUrl: process.env.NEXT_PUBLIC_WS_URL,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
    siteUrlFallback: process.env.NEXT_PUBLIC_SITE_URL,
  });
}
