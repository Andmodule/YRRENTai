/**
 * Inbound Resend webhook: allowlist by SMTP From host (domain after @).
 * OTA platforms use many subdomains (e.g. guest.*, mail.*, notify.*); exact-only lists miss real mail.
 */

/** `*.example.com` matches `example.com` and `a.b.example.com`. */
export function matchesHostPattern(host: string, entry: string): boolean {
  const h = host.trim().toLowerCase();
  const e = entry.trim().toLowerCase();
  if (!h || !e) return false;
  if (e.startsWith('*.')) {
    const base = e.slice(2);
    if (!base) return false;
    return h === base || h.endsWith('.' + base);
  }
  return h === e;
}

/**
 * Any host under booking.com / airbnb.com is treated as that OTA’s infrastructure
 * (they control the public suffix tree; this is not “any .com”).
 */
export function isTrustedOtaInfrastructureHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  return (
    h === 'booking.com' ||
    h.endsWith('.booking.com') ||
    h === 'airbnb.com' ||
    h.endsWith('.airbnb.com')
  );
}

function matchesGmailFamily(host: string): boolean {
  return (
    host === 'gmail.com' ||
    host === 'googlemail.com' ||
    host.endsWith('.gmail.com') ||
    host.endsWith('.googlemail.com')
  );
}

export function isInboundSenderHostAllowed(
  host: string,
  allowedEntries: string[],
  allowGmailGooglemail: boolean,
): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  for (const entry of allowedEntries) {
    if (matchesHostPattern(h, entry)) return true;
  }
  if (isTrustedOtaInfrastructureHost(h)) return true;
  if (allowGmailGooglemail && matchesGmailFamily(h)) return true;
  return false;
}
