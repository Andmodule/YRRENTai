/**
 * Shown to the guest when we escalate but the model did not follow the format
 * or used forbidden self-service wording (server-side fallback).
 */
export const ESCALATION_MARKER = '[ESCALATE]' as const;

/**
 * Strip trailing `[ESCALATE]` (case-insensitive, optional leading newline/spaces).
 */
export function parseAssistantEscalation(fullText: string): {
  rawEndsEscalate: boolean;
  textWithoutMarker: string;
} {
  const trimmed = fullText.trimEnd();
  const re = /\n?\s*\[ESCALATE\]\s*$/i;
  if (!re.test(trimmed)) {
    return { rawEndsEscalate: false, textWithoutMarker: fullText.trim() };
  }
  const textWithoutMarker = trimmed.replace(re, '').trim();
  return { rawEndsEscalate: true, textWithoutMarker };
}

export const GUEST_ESCALATION_FALLBACK_MESSAGE =
  'Я уточню это у хозяина и скоро отвечу вам. Если появятся другие вопросы — с удовольствием помогу!';

const FORBIDDEN_GUEST_REPLY_PATTERNS: RegExp[] = [
  /свяжитесь\s+напрямую/i,
  /свяжитесь\s+с\s+хозяин/i,
  /свяжитесь\s+с\s+владельц/i,
  /свяжитесь\s+с\s+администрац/i,
  /обратитесь\s+к\s+хозяин/i,
  /обратитесь\s+к\s+владельц/i,
  /обратитесь\s+к\s+администрац/i,
  /обратитесь\s+напрямую/i,
  /напишите\s+(?:на\s+)?(?:хозяин|владельц|администрац)/i,
  /позвоните\s+(?:хозяин|владельц|администрац)/i,
  /contact\s+the\s+owner/i,
  /contact\s+the\s+host/i,
  /contact\s+the\s+property\s+manager/i,
  /reach\s+out\s+to\s+the\s+host/i,
  /reach\s+the\s+owner/i,
];

/**
 * True if the model told the guest to contact the host/owner themselves — must escalate and replace text.
 */
export function shouldForceEscalationGuestReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return FORBIDDEN_GUEST_REPLY_PATTERNS.some((re) => re.test(t));
}

export function buildSystemPrompt(propertyName: string, knowledgeBase: string): string {
  return [
    `You are a helpful AI assistant for the rental property "${propertyName}".`,
    '',
    'PRIMARY RULE — KNOWLEDGE BASE:',
    '- You may ONLY state facts that appear in the "Knowledge Base" section below.',
    '- If the guest\'s question is NOT fully answered by that text (missing details, different topic, or no matching entry), you MUST escalate — see ESCALATION below.',
    '- Never invent amenities, rules, prices, addresses, or policies.',
    '- Never guess from general world knowledge when the KB is silent on that point.',
    '',
    'ABSOLUTELY FORBIDDEN (never include in your reply to the guest):',
    '- Telling the guest to contact the host, owner, administrator, or property manager themselves.',
    '- Telling them to call, email, message, or write to the host/owner "directly" or "напрямую".',
    '- Suggesting they use Booking.com, Airbnb, or any external channel to get the answer.',
    '- Any wording that passes responsibility to the guest to reach the host.',
    '- If you cannot answer from the KB, you do NOT redirect the guest — the system will notify staff; your job is only the short message + [ESCALATE].',
    '',
    'ESCALATION — WHEN YOU MUST USE IT:',
    '- Use escalation whenever the KB does not contain the specific information needed to answer, or you are unsure.',
    '- Write ONE short, warm sentence that you will check with the host and reply soon (in the guest\'s language).',
    '- Example (Russian): "Я уточню это у хозяина и скоро отвечу вам."',
    '- Example (English): "I\'ll check this with the host and get back to you shortly."',
    '- On a NEW LINE at the very end of your entire reply, add exactly this token and nothing after it: [ESCALATE]',
    '- The token [ESCALATE] is stripped before the guest sees the message — but you MUST include it for routing.',
    '- If you fully answered using ONLY facts from the knowledge base, do NOT add [ESCALATE].',
    '',
    '--- Knowledge Base ---',
    knowledgeBase,
  ].join('\n');
}
