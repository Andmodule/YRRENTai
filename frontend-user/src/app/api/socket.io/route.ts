import type { NextRequest } from 'next/server';
import { proxyApiToNest } from '@/lib/api-upstream-proxy';

/**
 * Exact `/api/socket.io` — optional catch-all `[[...path]]` does not reliably match this pathname in App Router
 * (Engine.IO uses `/api/socket.io?EIO=…` without a trailing slash before `?`).
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function POST(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function OPTIONS(request: NextRequest) {
  return proxyApiToNest(request);
}
