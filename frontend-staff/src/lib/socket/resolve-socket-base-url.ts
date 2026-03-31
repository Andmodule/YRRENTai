/**
 * Socket.IO must hit the NestJS host directly. Next.js rewrites do not reliably
 * proxy /api/socket.io (polling + upgrade), which causes 404 on the staff dev port.
 */
export function resolveSocketBaseUrl(): string {
  const wsOverride = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsOverride) {
    try {
      return new URL(wsOverride).origin;
    } catch {
      return wsOverride.replace(/\/$/, '');
    }
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    try {
      return new URL(apiUrl).origin;
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3010';
}
