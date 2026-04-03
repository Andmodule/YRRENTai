/**
 * Single source of truth for Socket.IO base URL (chat + tasks namespaces).
 * Same-origin + Next `/api` proxy must win over `NEXT_PUBLIC_WS_URL` in dev and on localhost:port splits.
 */

function wsUrlToOrigin(raw: string): string {
  const normalized = raw.startsWith('ws') ? `http${raw.slice(2)}` : raw;
  try {
    return new URL(normalized).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function isLoopbackHost(h: string): boolean {
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '::1';
}

/**
 * Use the page origin when Next proxies `/api` to Nest: same hostname different port, or both loopback
 * (e.g. page `localhost:3012` + API `127.0.0.1:3010` — still same machine, must not bypass the proxy).
 */
function shouldProxySocketViaPageOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) return false;
  try {
    const api = new URL(apiUrl);
    const page = new URL(window.location.origin);
    if (api.origin === page.origin) return false;
    if (api.port === page.port) return false;
    if (api.hostname === page.hostname) return true;
    return isLoopbackHost(api.hostname) && isLoopbackHost(page.hostname);
  } catch {
    return false;
  }
}

export function resolveSocketBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if (process.env.NEXT_PUBLIC_SOCKET_SAME_ORIGIN === 'true') {
      return window.location.origin;
    }
    if (process.env.NODE_ENV === 'development') {
      return window.location.origin;
    }
    if (shouldProxySocketViaPageOrigin()) {
      return window.location.origin;
    }
  }

  const wsOverride = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsOverride) {
    return wsUrlToOrigin(wsOverride);
  }

  if (typeof window !== 'undefined') {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (apiUrl) {
      try {
        const apiOrigin = new URL(apiUrl).origin;
        if (apiOrigin !== window.location.origin) {
          return apiOrigin;
        }
      } catch {
        /* ignore */
      }
    }
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3012';
}
