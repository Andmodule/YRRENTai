/** Title line without time — guest · property name (Telegram-style metadata). */
export function formatGuestAndProperty(
  externalGuestKey: string | null,
  propertyName: string,
  guestDisplayName?: string | null,
): string {
  const raw = externalGuestKey?.trim() || '—';
  const fallback = raw.startsWith('email:') ? raw.slice('email:'.length) : raw;
  const label = guestDisplayName?.trim() || fallback;
  return `${label} · ${propertyName}`;
}

/**
 * Time in the list / header on the right (Telegram-style):
 * today → short clock; otherwise → date + time compact.
 */
export function formatTelegramStyleTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const isToday = startOfMsg.getTime() === startOfToday.getTime();

  if (isToday) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Time inside message bubble (Telegram-style): time only today, else short date + time. */
export function formatBubbleTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const isToday = startOfMsg.getTime() === startOfToday.getTime();

  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;

  const datePart = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${datePart}, ${time}`;
}
