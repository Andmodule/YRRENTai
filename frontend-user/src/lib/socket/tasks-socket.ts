import { io, type Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

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

/**
 * Socket.IO client for `/tasks` namespace (task list invalidation).
 */
export function connectTasksSocket(): Socket {
  const base = resolveSocketBaseUrl();
  const useProxy = typeof window !== 'undefined' && base === window.location.origin;
  return io(`${base}/tasks`, {
    path: '/api/socket.io',
    auth: (cb) => {
      fetchWsToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    withCredentials: true,
    transports: useProxy ? ['polling', 'websocket'] : ['websocket', 'polling'],
  });
}
