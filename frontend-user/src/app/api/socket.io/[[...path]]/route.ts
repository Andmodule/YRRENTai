import type { NextRequest } from 'next/server';
import { proxyApiToNest } from '@/lib/api-upstream-proxy';

/**
 * Explicit handler for `/api/socket.io` — the generic `app/api/[[...path]]/route.ts` does not match this path
 * (segment `socket.io` with a dot) → 404 on Engine.IO polling. Rewrites alone are brittle across Next versions.
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
