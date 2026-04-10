import axios from 'axios';

/** Nest/axios: `{ message: string | string[] }` or `{ message: { message: string } }` */
export function getApiErrorMessage(err: unknown): string | null {
  if (!axios.isAxiosError(err) || err.response?.data == null) return null;
  const data = err.response.data as { message?: unknown };
  const m = data.message;
  if (typeof m === 'string' && m.trim()) return m.trim();
  if (Array.isArray(m) && m.length && m.every((x) => typeof x === 'string')) return m.join(', ');
  return null;
}
