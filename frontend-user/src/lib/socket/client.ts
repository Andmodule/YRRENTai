import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';

/**
 * Where Socket.IO connects:
 * - If `NEXT_PUBLIC_WS_URL` is set → that origin.
 * - Else if `NEXT_PUBLIC_API_URL` is a different origin than the page (e.g. Vercel → Render) → API origin (direct WS; auth via POST `/auth/ws-token`).
 * - Else same origin as the page (local Next rewrite to the backend).
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
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (typeof window !== 'undefined' && apiUrl) {
    try {
      const apiOrigin = new URL(apiUrl).origin;
      if (apiOrigin !== window.location.origin) {
        return apiOrigin;
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined') {
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
  chatSocket = io(`${base}/chat`, {
    path: '/api/socket.io',
    auth: (cb) => {
      fetchWsToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    withCredentials: true,
    transports: ['websocket', 'polling'],
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
