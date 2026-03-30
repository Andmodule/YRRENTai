import { io, Socket } from 'socket.io-client';

/**
 * Socket must use the same browser origin as the Next.js app when auth is httpOnly cookies:
 * API is proxied via `next.config` rewrites (`/api/*` → backend), so `access_token` (Path=/api)
 * is scoped to this host. A direct `wss://api.render.com` connection would not receive those cookies.
 *
 * Override with NEXT_PUBLIC_WS_URL only for custom setups (e.g. local tooling).
 */
function resolveSocketBaseUrl(): string {
  const override = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (override) {
    return override.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3012';
}

let chatSocket: Socket | null = null;

export function getChatSocket(): Socket {
  if (!chatSocket) {
    const base = resolveSocketBaseUrl();
    chatSocket = io(`${base}/chat`, {
      path: '/api/socket.io',
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return chatSocket;
}

export function connectChatSocket(): Socket {
  const s = getChatSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectChatSocket(): void {
  if (chatSocket?.connected) {
    chatSocket.disconnect();
  }
}
