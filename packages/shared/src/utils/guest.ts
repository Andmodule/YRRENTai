/** Lowercase trimmed email for deduplication. */
export function normalizeGuestEmail(email: string | undefined | null): string | null {
  if (email == null) return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** Digits-only phone for deduplication (MVP). */
export function normalizeGuestPhone(phone: string | undefined | null): string | null {
  if (phone == null) return null;
  const t = phone.trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}
