const TASK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses Telegram Mini App `start_param` from `startapp=task_<uuid_with_underscores>`.
 */
export function parseTaskUuidFromTelegramStartParam(startParam: string | undefined): string | null {
  if (!startParam || typeof startParam !== 'string') return null;
  if (!startParam.startsWith('task_')) return null;
  const rest = startParam.slice('task_'.length);
  const uuid = rest.replace(/_/g, '-');
  if (!TASK_UUID_RE.test(uuid)) return null;
  return uuid;
}
