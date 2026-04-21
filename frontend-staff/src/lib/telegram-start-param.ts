const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query key for deep link to task detail (совпадает с frontend-user TMA). */
export const STAFF_TASK_DETAIL_QUERY = 'task';

/**
 * Parses Telegram Mini App `start_param` from `startapp=task_<uuid_with_underscores>`.
 */
export function parseTaskUuidFromTelegramStartParam(startParam: string | undefined): string | null {
  if (!startParam || typeof startParam !== 'string') return null;
  if (!startParam.startsWith('task_')) return null;
  const rest = startParam.slice('task_'.length);
  const uuid = rest.replace(/_/g, '-');
  if (!UUID_RE.test(uuid)) return null;
  return uuid;
}

/**
 * Parses `startapp=route_<uuid_with_underscores>` (уведомление о маршруте доставки).
 */
export function parseRouteUuidFromTelegramStartParam(startParam: string | undefined): string | null {
  if (!startParam || typeof startParam !== 'string') return null;
  if (!startParam.startsWith('route_')) return null;
  const rest = startParam.slice('route_'.length);
  const uuid = rest.replace(/_/g, '-');
  if (!UUID_RE.test(uuid)) return null;
  return uuid;
}

export function readTelegramWebAppStartParam(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  return typeof sp === 'string' ? sp : undefined;
}
