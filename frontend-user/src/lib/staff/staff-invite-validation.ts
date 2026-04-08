/** Matches backend `CreateStaffInviteDto` phone (max 32) — optional field. */
export function isValidStaffInvitePhone(value: string): boolean {
  const s = value.trim();
  if (!s) return true;
  if (s.length > 32) return false;
  if (!/^[\d\s+()./-]+$/.test(s)) return false;
  const digitCount = (s.match(/\d/g) ?? []).length;
  return digitCount >= 6;
}

/** Optional Telegram @username before link — 5–32 chars [a-zA-Z0-9_]. */
export function isValidStaffTelegramUsername(value: string): boolean {
  const s = value.trim().replace(/^@+/, '').toLowerCase();
  if (!s) return true;
  if (s.length < 5 || s.length > 32) return false;
  return /^[a-z0-9_]+$/.test(s);
}
