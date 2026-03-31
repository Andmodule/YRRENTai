import { HttpException } from '@nestjs/common';

/**
 * Zodomus often returns HTTP 200 with success/failure in `body.status.returnCode`
 * (0 и 200 — успех; 400+ — ошибка). Иногда `returnCode` дублируется на верхнем уровне тела.
 */
export function isZodomusSuccessBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  const b = body as Record<string, unknown>;

  const st = b.status;
  if (st && typeof st === 'object') {
    const rc = (st as { returnCode?: unknown }).returnCode;
    if (rc !== undefined && rc !== null) {
      const n = Number(rc);
      if (Number.isFinite(n)) return n < 400;
    }
  }

  if (b.returnCode !== undefined && b.returnCode !== null) {
    const n = Number(b.returnCode);
    if (Number.isFinite(n)) return n < 400;
  }

  return true;
}

export function assertZodomusSuccess(label: string, body: unknown): void {
  if (isZodomusSuccessBody(body)) return;
  const st = (body as { status?: { returnCode?: unknown; returnMessage?: string } }).status;
  const rc = st?.returnCode;
  const msg = st?.returnMessage ?? JSON.stringify(body);
  throw new HttpException(
    { message: 'Zodomus API error', upstream: 'zodomus', returnCode: rc, detail: msg, label },
    502,
  );
}
