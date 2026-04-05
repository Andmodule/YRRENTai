/**
 * Cheap inbound-mail filters (no LLM). Aligns with common 2026 practice: drop obvious machine traffic
 * (RFC 3834 Auto-Submitted, vacation X-Autoreply, list/bulk Precedence) before storing as guest chat.
 * Does not replace SPF/DKIM/DMARC (Resend / your MX should enforce those upstream).
 */

export type NormalizedHeaders = Record<string, string | string[] | undefined>;

function headerFirst(h: NormalizedHeaders, name: string): string | undefined {
  const v = h[name.toLowerCase()];
  if (v == null) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : String(s).trim();
}

/**
 * Drop automated / list traffic that should not become guest chat lines.
 */
export function shouldDropInboundByMailHeaders(h: NormalizedHeaders): { drop: boolean; reason?: string } {
  const autoSubmitted = headerFirst(h, 'auto-submitted');
  if (autoSubmitted && /^auto-generated$/i.test(autoSubmitted)) {
    return { drop: true, reason: 'Auto-Submitted: auto-generated' };
  }

  const xAutoreply = headerFirst(h, 'x-autoreply');
  if (xAutoreply && /^(yes|true|1)$/i.test(xAutoreply)) {
    return { drop: true, reason: 'X-Autoreply' };
  }

  const precedence = headerFirst(h, 'precedence');
  if (precedence && /^(bulk|junk|list)$/i.test(precedence)) {
    return { drop: true, reason: `Precedence: ${precedence}` };
  }

  return { drop: false };
}
