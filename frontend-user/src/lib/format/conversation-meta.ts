/** Strip `email:` prefix and optional `|reservation:…` suffix from inbox key for display. */
export function emailLikeFromExternalGuestKey(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('email:')) s = s.slice('email:'.length);
  const pipeIdx = s.indexOf('|reservation:');
  if (pipeIdx >= 0) s = s.slice(0, pipeIdx).trim();
  return s;
}

/** Title line without time — guest · property name (Telegram-style metadata). */
export function formatGuestAndProperty(
  externalGuestKey: string | null,
  propertyName: string,
  guestDisplayName?: string | null,
): string {
  const raw = externalGuestKey?.trim() || '—';
  const fallback = raw.startsWith('email:') ? emailLikeFromExternalGuestKey(raw) : raw;
  const label = guestDisplayName?.trim() || fallback;
  return `${label} · ${propertyName}`;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** When the message is not from «today»: day + month; add year if not the current calendar year. */
function formatNonTodayDateLabel(d: Date, locale: string, referenceNow: Date): string {
  const sameYear = d.getFullYear() === referenceNow.getFullYear();
  return d.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
  });
}

/**
 * Inbox list / header on the right: today → time only; otherwise → date only (no time).
 */
export function formatTelegramStyleTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameCalendarDay(d, now)) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return formatNonTodayDateLabel(d, locale, now);
}

/** Inside message bubble: today → time only; otherwise → date only (no time). */
export function formatBubbleTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameCalendarDay(d, now)) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return formatNonTodayDateLabel(d, locale, now);
}
