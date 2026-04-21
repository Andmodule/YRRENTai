import { HttpException } from '@nestjs/common';

type ZodomusStatusBlock = { returnCode?: unknown; returnMessage?: string };

/**
 * Zodomus often returns HTTP 200 with success/failure in `body.status.returnCode`
 * (0 и 200 — успех; 400+ — ошибка). Иногда `status` лежит внутри `body.data`.
 */
function extractStatusBlock(b: Record<string, unknown>): ZodomusStatusBlock | undefined {
  if (b.status && typeof b.status === 'object') {
    return b.status as ZodomusStatusBlock;
  }
  const data = b.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (d.status && typeof d.status === 'object') {
      return d.status as ZodomusStatusBlock;
    }
  }
  return undefined;
}

function isSuccessReturnCode(rc: unknown): boolean {
  if (rc === undefined || rc === null) return true;
  const n = Number(rc);
  if (!Number.isFinite(n)) return true;
  return n < 400;
}

export function isZodomusSuccessBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  const b = body as Record<string, unknown>;

  const st = extractStatusBlock(b);
  if (st) {
    const rc = st.returnCode;
    if (rc !== undefined && rc !== null) {
      return isSuccessReturnCode(rc);
    }
  }

  if (b.returnCode !== undefined && b.returnCode !== null) {
    return isSuccessReturnCode(b.returnCode);
  }

  return true;
}

export function assertZodomusSuccess(label: string, body: unknown): void {
  if (isZodomusSuccessBody(body)) return;
  const b = body as Record<string, unknown>;
  const st = extractStatusBlock(b);
  const rc = st?.returnCode ?? b.returnCode;
  const msg = st?.returnMessage ?? JSON.stringify(body);
  throw new HttpException(
    {
      message: `Zodomus API error (${label}): returnCode=${String(rc)} — ${msg}`,
      upstream: 'zodomus',
      returnCode: rc,
      detail: msg,
      label,
    },
    502,
  );
}

/**
 * Zodomus sandbox limits how many times GET /reservations can be called per reservation id
 * (e.g. "Reservation already downloaded 5 times. The limit was reached.").
 * After that, further sync attempts must not be counted as hard failures if data is already in RentAI.
 */
export function isZodomusReservationDownloadLimitError(e: unknown): boolean {
  if (!(e instanceof HttpException)) return false;
  const r = e.getResponse();
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  const text = `${String(o.detail ?? '')} ${String(o.message ?? '')}`.toLowerCase();
  return (
    text.includes('already downloaded') ||
    text.includes('limit was reached') ||
    text.includes('download limit')
  );
}

/** Substrings from Zodomus logs that mean the listing/property is misconfigured — do not retry in a loop. */
const ZODOMUS_PERMANENT_MISCONFIG_SUBSTRINGS = [
  'invalid property id',
  'property status not active',
  'invalid listing',
] as const;

/** Lowercase fingerprint for matching permanent upstream errors (HTTP body or Error.message). */
export function zodomusErrorFingerprint(e: unknown): string {
  if (e instanceof HttpException) {
    return formatZodomusHttpException(e).toLowerCase();
  }
  if (e instanceof Error) {
    return e.message.toLowerCase();
  }
  return String(e).toLowerCase();
}

/** True when Zodomus indicates wrong external id / inactive property — stop queue + availability retries. */
export function isZodomusPermanentMisconfiguration(e: unknown): boolean {
  const t = zodomusErrorFingerprint(e);
  return ZODOMUS_PERMANENT_MISCONFIG_SUBSTRINGS.some((s) => t.includes(s));
}

/** Человекочитаемая строка для логов при HttpException из Zodomus. */
export function formatZodomusHttpException(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const parts = [o.message, o.detail, o.label].filter((x) => typeof x === 'string');
      if (parts.length) return parts.join(' | ');
      return JSON.stringify(r);
    }
  }
  return String(e);
}
