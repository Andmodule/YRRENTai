import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/** Nest base URL (same as app/api/[[...path]] proxy). */
const backendBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3010').replace(/\/$/, '');

export function buildUpstreamApiUrl(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  /**
   * Nest/Express Engine.IO only serves `/api/socket.io/` (slash before `?`). A request to
   * `/api/socket.io?EIO=4` (no slash) returns 404 — the Socket.IO client uses the latter form.
   */
  if (pathname === '/api/socket.io' || pathname === '/api/socket.io/') {
    return `${backendBase}/api/socket.io/${search}`;
  }
  /** After stripping `/api`, remainder must not start with `/` or we get `.../api//...` → upstream 404. */
  const sub =
    pathname.replace(/^\/api\/?/, '').replace(/^\/+/, '').replace(/\/$/, '') || '';
  return sub ? `${backendBase}/api/${sub}${search}` : `${backendBase}/api/${search}`;
}

function forwardHeaders(request: NextRequest): Headers {
  const out = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'host' || k === 'connection') return;
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
 * Node `fetch` decompresses gzip/br bodies but may leave `Content-Encoding` / `Content-Length` from upstream.
 * Forwarding those with the decompressed stream causes `ERR_CONTENT_DECODING_FAILED` in the browser (Socket.IO polling).
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
  const headers = forwardHeaders(request);
  const init: RequestInit = {
    method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
    (init as RequestInit & { duplex?: string }).duplex = 'half';
  }
  try {
    const res = await fetch(url, init);
    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyUpstreamHeaders(res),
    });
  } catch (error) {
    const code = upstreamUnreachableCode(error);
    const refused = code === 'ECONNREFUSED' || code === 'ENOTFOUND';
    return NextResponse.json(
      {
        message: refused
          ? `Nest API unreachable (${backendBase}). Start the backend (e.g. pnpm dev:backend).`
          : 'Proxy fetch failed',
        code: 'BACKEND_UNREACHABLE',
        errno: code ?? 'FETCH_FAILED',
        upstream: url,
      },
      { status: 503 },
    );
  }
}
