/**
 * Socket.IO must use the NestJS API origin. Next.js Route Handlers proxy HTTP only;
 * they cannot complete the WebSocket upgrade, so the client must not use the page origin
 * when the API runs on another host/port.
 */

export type ResolveSocketBaseUrlInput = {
  /** Optional: explicit WS URL (ws:// or wss://) if it must differ from API_URL */
  wsUrl?: string | null;
  /** Nest base URL, e.g. https://api.example.com — primary source for production */
  apiUrl?: string | null;
  /** Browser `window.location.origin` when API URL is unset (reverse-proxy same-host setups) */
  pageOrigin?: string | null;
  /** SSR / build fallback */
  siteUrlFallback?: string | null;
};

function matchHttpOrigin(s: string): string | undefined {
  const m = s.trim().match(/^(https?:\/\/[^/?#]+)/i);
  return m?.[1];
}

function wsOrHttpToOrigin(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  let normalized = t;
  if (t.startsWith('wss://')) normalized = `https://${t.slice(6)}`;
  else if (t.startsWith('ws://')) normalized = `http://${t.slice(5)}`;
  const origin = matchHttpOrigin(normalized);
  if (origin) return origin;
  return t.replace(/\/$/, '');
}

/**
 * Base URL for `io(base, { path: '/api/socket.io', ... })` — no path, no namespace.
 */
export function resolveSocketBaseUrlFromEnv(input: ResolveSocketBaseUrlInput): string {
  const ws = input.wsUrl?.trim();
  if (ws) {
    return wsOrHttpToOrigin(ws);
  }
  const api = input.apiUrl?.trim();
  if (api) {
    const origin = matchHttpOrigin(api);
    if (origin) return origin;
  }
  const page = input.pageOrigin?.trim();
  if (page) {
    return page;
  }
  return input.siteUrlFallback?.replace(/\/$/, '') || 'http://localhost:3012';
}
