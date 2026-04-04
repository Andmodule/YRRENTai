import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/lib/api/client';
import { resolveSocketBaseUrl } from '@/lib/socket/resolve-socket-origin';

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
