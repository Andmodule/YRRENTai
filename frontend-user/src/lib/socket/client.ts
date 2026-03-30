import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';

/**
 * Where Socket.IO connects:
 * - `NEXT_PUBLIC_WS_URL` → that origin (explicit override).
 * - Development in the browser → **same origin** as the page (e.g. :3012) so requests hit Next.js rewrites
 *   (`/api/*` → backend). Direct `ws://localhost:3010` fails if the API process is not running; same-origin uses
 *   HTTP long-polling through the proxy first.
 * - Production cross-origin (e.g. Vercel → Render) → API origin + `/auth/ws-token` in handshake.
 * - Else same origin.
 */
function resolveSocketBaseUrl(): string {
  const wsOverride = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsOverride) {
    try {
      return new URL(wsOverride).origin;
    } catch {
      return wsOverride.replace(/\/$/, '');
    }
  }
  if (typeof window !== 'undefined') {
    if (process.env.NEXT_PUBLIC_SOCKET_SAME_ORIGIN === 'true') {
      return window.location.origin;
    }
    if (process.env.NODE_ENV === 'development') {
      return window.location.origin;
    }
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
