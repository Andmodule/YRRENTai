import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates Telegram Web App `initData` (login widget / Mini App).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramWebAppInitData(
  initData: string,
  botToken: string,
): { ok: true; telegramUserId: number } | { ok: false } {
  const trimmed = initData.trim();
  if (!trimmed || !botToken.trim()) {
    return { ok: false };
  }

  const params = new URLSearchParams(trimmed);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false };
  }

  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest();

  let hashBuf: Buffer;
  try {
    hashBuf = Buffer.from(hash, 'hex');
  } catch {
    return { ok: false };
  }
  if (hashBuf.length !== computed.length || !timingSafeEqual(hashBuf, computed)) {
    return { ok: false };
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) {
    return { ok: false };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > 86400) {
    return { ok: false };
  }

  const userJson = params.get('user');
  if (!userJson) {
    return { ok: false };
  }
  let user: { id?: number };
  try {
    user = JSON.parse(userJson) as { id?: number };
  } catch {
    return { ok: false };
  }
  if (!user?.id || typeof user.id !== 'number') {
    return { ok: false };
  }

  return { ok: true, telegramUserId: user.id };
}
