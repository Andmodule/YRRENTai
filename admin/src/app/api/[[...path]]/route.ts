import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/** Proxy /api/* → Nest (same-origin cookies on admin port, e.g. :3001). */
const backendBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3010').replace(/\/$/, '');

export const runtime = 'nodejs';

function buildTargetUrl(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const sub = pathname.replace(/^\/api\/?/, '').replace(/\/$/, '') || '';
  const search = request.nextUrl.search;
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

/**
 * Nest sets two httpOnly cookies (access + refresh). `new Headers(res.headers)` collapses
 * duplicate `Set-Cookie` keys — the browser only stores one cookie and `/users/me` returns 401.
 */
function copyUpstreamHeaders(res: Response): Headers {
  const out = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
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

async function proxy(request: NextRequest): Promise<NextResponse> {
  const url = buildTargetUrl(request);
  const method = request.method.toUpperCase();
  const headers = forwardHeaders(request);
  const init: RequestInit = {
    method,
    headers,
    redirect: 'manual',
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

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}

export async function PUT(request: NextRequest) {
  return proxy(request);
}

export async function PATCH(request: NextRequest) {
  return proxy(request);
}

export async function DELETE(request: NextRequest) {
  return proxy(request);
}

export async function OPTIONS(request: NextRequest) {
  return proxy(request);
}
