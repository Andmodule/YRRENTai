import { io, type Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-origin';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

/**
 * Socket.IO client for `/calendar` namespace (same handshake as `/tasks`).
 * Caller owns lifecycle — call `socket.disconnect()` when unsubscribing (e.g. layout unmount).
 */
export function connectCalendarSocket(): Socket {
  const base = resolveSocketBaseUrl();
  return io(`${base}/calendar`, {
    path: '/api/socket.io',
    auth: (cb) => {
      fetchWsToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
}
