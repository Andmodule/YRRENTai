import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/** Proxy /api/* → Nest (same-origin cookies; pathname-based target for reliable routing with next-intl + Turbopack). */
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
  const res = await fetch(url, init);
  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
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
