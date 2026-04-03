import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';

/**
 * Where Socket.IO connects:
 * - `NEXT_PUBLIC_SOCKET_SAME_ORIGIN=true` → page origin (always proxy through Next when API is same host).
 * - **Browser + `NODE_ENV=development`** → page origin (Next dev proxies `/api/socket.io` → Nest). Must run **before**
 *   `NEXT_PUBLIC_WS_URL` — otherwise `ws://localhost:3010` bypasses the proxy and the socket fails while the app is on :3012.
 * - Same host `localhost` / `127.0.0.1` but different port as `NEXT_PUBLIC_API_URL` (e.g. `next start` on :3012, API :3010) → page origin.
 * - `NEXT_PUBLIC_WS_URL` → explicit origin (production / special).
 * - Production cross-origin (e.g. Vercel → Render) → `NEXT_PUBLIC_API_URL` origin when ≠ page origin.
 * - Else page origin.
 */
function wsUrlToOrigin(raw: string): string {
  const normalized = raw.startsWith('ws') ? `http${raw.slice(2)}` : raw;
  try {
    return new URL(normalized).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

/** True when Next (or similar) on this tab’s origin proxies `/api` to Nest on `NEXT_PUBLIC_API_URL`. */
function shouldUseSameOriginSocketProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) return false;
  try {
    const api = new URL(apiUrl);
    const page = new URL(window.location.origin);
    if (api.origin === page.origin) return false;
    if (api.hostname !== page.hostname) return false;
    if (api.hostname !== 'localhost' && api.hostname !== '127.0.0.1') return false;
    return api.port !== page.port;
  } catch {
    return false;
  }
}

function resolveSocketBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if (process.env.NEXT_PUBLIC_SOCKET_SAME_ORIGIN === 'true') {
      return window.location.origin;
    }
    if (process.env.NODE_ENV === 'development') {
      return window.location.origin;
    }
    if (shouldUseSameOriginSocketProxy()) {
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

let chatSocket: Socket | null = null;

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

export async function connectChatSocket(): Promise<Socket> {
  if (chatSocket?.connected) {
    return chatSocket;
  }
  if (chatSocket) {
    chatSocket.removeAllListeners();
    chatSocket.disconnect();
    chatSocket = null;
  }
  const base = resolveSocketBaseUrl();
  const useProxy =
    typeof window !== 'undefined' && base === window.location.origin;
  chatSocket = io(`${base}/chat`, {
    path: '/api/socket.io',
    auth: (cb) => {
      fetchWsToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    withCredentials: true,
    /** Polling first when using Next rewrites — works reliably; WS may follow if the dev server proxies upgrades. */
    transports: useProxy ? ['polling', 'websocket'] : ['websocket', 'polling'],
    autoConnect: false,
  });
  chatSocket.connect();
  return chatSocket;
}

export function getChatSocket(): Socket | null {
  return chatSocket;
}

export function disconnectChatSocket(): void {
  if (chatSocket) {
    chatSocket.removeAllListeners();
    chatSocket.disconnect();
    chatSocket = null;
  }
}
