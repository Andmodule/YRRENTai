/** Normalize id for comparison: trim, lower case; UUIDs compared without hyphens. */
export function normalizeId(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t) return null;
  const lower = t.toLowerCase();
  const compact = lower.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/.test(compact)) return compact;
  return lower;
}

export function idEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeId(a) === normalizeId(b);
}
