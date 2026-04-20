import { io, type Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-origin';

async function fetchWsToken(): Promise<string> {
  const res = await apiClient.post<{ data: { token: string } }>('/auth/ws-token', {});
  return res.data.data.token;
}

let _socket: Socket | null = null;

/**
 * Returns a singleton Socket.IO client for the `/calendar` namespace.
 * Reuses an existing connected socket to avoid duplicate connections.
 */
export function getCalendarSocket(): Socket {
  if (_socket?.connected) return _socket;

  const base = resolveSocketBaseUrl();
  _socket = io(`${base}/calendar`, {
    path: '/api/socket.io',
    auth: (cb) => {
      fetchWsToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: '' }));
    },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  return _socket;
}

export function disconnectCalendarSocket(): void {
  _socket?.disconnect();
  _socket = null;
}
