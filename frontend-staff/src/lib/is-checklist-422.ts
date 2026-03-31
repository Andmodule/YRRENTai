import axios from 'axios';

/** Nest 422 from incomplete checklist; body may nest fields under `message` */
export function parseChecklist422(err: unknown): {
  uncheckedRequired: string[];
} | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 422) return null;
  const data = err.response.data as Record<string, unknown>;
  const nested =
    typeof data?.message === 'object' && data.message !== null && !Array.isArray(data.message)
      ? (data.message as { uncheckedRequired?: unknown })
      : null;
  const arr =
    (Array.isArray(nested?.uncheckedRequired) ? nested.uncheckedRequired : null) ??
    (Array.isArray(data?.uncheckedRequired) ? data.uncheckedRequired : null);
  if (!arr) return null;
  return { uncheckedRequired: arr.filter((x): x is string => typeof x === 'string') };
}
