/**
 * Исправляет ссылку вида `...?start=<uuid>https://t.me/...` (двойная вставка / баг клиента),
 * оставляя один корректный deep link с UUID в `start`.
 */
export function normalizeTelegramStaffInviteLink(raw: string): string {
  const t = raw.trim();
  if (!t) return t;

  const botMatch = t.match(/^(https:\/\/t\.me\/[a-zA-Z0-9_]+)/i);
  const q = t.indexOf('?start=');
  if (!botMatch || q === -1) return t;

  const afterStart = t.slice(q + '?start='.length);
  const uuidMatch = afterStart.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
  );
  if (uuidMatch) {
    return `${botMatch[1]}?start=${uuidMatch[1]}`;
  }
  return t;
}
