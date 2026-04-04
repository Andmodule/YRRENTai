/** Lowercase keys for case-insensitive header lookup (Resend / webhook payloads). */
export type NormalizedMailHeaders = Record<string, string | string[] | undefined>;

export function normalizeMailHeaders(
  h?: Record<string, string | string[]>,
): NormalizedMailHeaders {
  if (!h) return {};
  const out: NormalizedMailHeaders = {};
  for (const [k, v] of Object.entries(h)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

export function mailHeaderFirst(
  h: NormalizedMailHeaders,
  name: string,
): string | undefined {
  const v = h[name.toLowerCase()];
  if (v == null) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : String(s).trim() || undefined;
}
