import type { NextRequest } from 'next/server';
import { proxyApiToNest } from '@/lib/api-upstream-proxy';

/** Proxy /api/* → Nest (same-origin cookies; pathname-based target for reliable routing with next-intl + Turbopack). */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function POST(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function PUT(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function PATCH(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function DELETE(request: NextRequest) {
  return proxyApiToNest(request);
}

export async function OPTIONS(request: NextRequest) {
  return proxyApiToNest(request);
}
