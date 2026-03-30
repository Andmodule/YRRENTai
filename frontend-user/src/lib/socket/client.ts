import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3010';

let chatSocket: Socket | null = null;

export function getChatSocket(): Socket {
  if (!chatSocket) {
    chatSocket = io(`${WS_URL}/chat`, {
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
