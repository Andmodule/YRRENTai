/**
 * Removes internal `[ESCALATE]` markers (any case, optional inner spaces) everywhere.
 * Use for guest-facing UI, email bodies, and persisted chat content.
 */
export function stripEscalationForGuestDisplay(text: string): string {
  if (!text) return '';
  let s = text.replace(/\[\s*ESCALATE\s*\]/gi, '');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
