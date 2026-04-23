import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Nest origin (REST `/api/v1/…`, Socket.IO `/api/socket.io/…`).
 * Resolve per request so `.env.local` is always applied; prefer `API_URL` for server-only proxy target.
 * Default `127.0.0.1` avoids Windows/Node resolving `localhost` → IPv6 while Nest listens on IPv4-only.
 */
function getBackendBase(): string {
  const raw =
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    'http://127.0.0.1:3010';
  return raw.replace(/\/$/, '');
}

/**
 * REST paths pass through as-is. Engine.IO must hit `/api/socket.io/` (slash before `?`): Express matches that;
 * `/api/socket.io?EIO=…` can 404 if Engine.IO runs before Nest `main.ts` middleware — so normalize here (proxy always runs first).
 */
export function buildUpstreamApiUrl(request: NextRequest): string {
  const backendBase = getBackendBase();
  const pathname = request.nextUrl.pathname.replace(/\/+/g, '/');
  const search = request.nextUrl.search;
  if (pathname === '/api/socket.io' || pathname === '/api/socket.io/') {
    return `${backendBase}/api/socket.io/${search}`;
  }
  return `${backendBase}${pathname}${search}`;
}

function forwardHeaders(
  request: NextRequest,
  options?: { stripContentLengthForBufferedBody?: boolean },
): Headers {
  const out = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'host' || k === 'connection') return;
    if (options?.stripContentLengthForBufferedBody && k === 'content-length') return;
    out.set(key, value);
  });
  return out;
}

function upstreamUnreachableCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { cause?: unknown; code?: string };
  if (typeof e.code === 'string') return e.code;
  const c = e.cause;
  if (c && typeof c === 'object' && 'code' in c && typeof (c as { code: string }).code === 'string') {
    return (c as { code: string }).code;
  }
  return undefined;
}

/**
 * Undici/fetch decodes `Content-Encoding` into the body stream but does not strip the header.
 * Re-sending compressed metadata with an uncompressed body breaks clients (e.g. Socket.IO polling).
 * Stripping these is standard for application-level reverse proxies that buffer or transform the body.
 */
const STRIP_FROM_PROXY_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

function copyUpstreamHeaders(res: Response): Headers {
  const out = new Headers();
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie') return;
    if (STRIP_FROM_PROXY_RESPONSE.has(k)) return;
    out.append(key, value);
  });
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  if (list.length > 0) {
    for (const c of list) {
      out.append('Set-Cookie', c);
    }
  } else {
    const single = res.headers.get('set-cookie');
    if (single) out.append('Set-Cookie', single);
  }
  return out;
}

export async function proxyApiToNest(request: NextRequest): Promise<NextResponse> {
  const url = buildUpstreamApiUrl(request);
  const method = request.method.toUpperCase();
  const incomingType = (request.headers.get('content-type') || '').toLowerCase();
  const bufferMultipart = incomingType.includes('multipart/form-data');
  const headers = forwardHeaders(request, {
    stripContentLengthForBufferedBody: bufferMultipart,
  });
  const init: RequestInit = {
    method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    if (bufferMultipart) {
      init.body = await request.arrayBuffer();
    } else {
      init.body = request.body;
      (init as RequestInit & { duplex?: string }).duplex = 'half';
    }
  }
  try {
    const res = await fetch(url, init);
    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyUpstreamHeaders(res),
    });
  } catch (error) {
    const backendBase = getBackendBase();
    const code = upstreamUnreachableCode(error);
    const refused = code === 'ECONNREFUSED' || code === 'ENOTFOUND';
    const devHint =
      process.env.NODE_ENV === 'development' && error instanceof Error ? { detail: error.message } : {};
    return NextResponse.json(
      {
        message: refused
          ? `Nest API unreachable (${backendBase}). Start the backend (e.g. pnpm dev:backend).`
          : 'Proxy fetch failed',
        code: 'BACKEND_UNREACHABLE',
        errno: code ?? 'FETCH_FAILED',
        upstream: url,
        ...devHint,
      },
      { status: 503 },
    );
  }
}
