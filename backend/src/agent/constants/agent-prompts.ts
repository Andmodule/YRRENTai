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

/** Russian fallback when the model did not return guest-safe text (escalation path). */
export const GUEST_ESCALATION_FALLBACK_MESSAGE =
  'Я уточню это у хозяина и скоро отвечу вам. Если появятся другие вопросы — с удовольствием помогу!';

/** English fallback — same role as {@link GUEST_ESCALATION_FALLBACK_MESSAGE}. */
export const GUEST_ESCALATION_FALLBACK_MESSAGE_EN =
  "I'll check this with the host and get back to you shortly. If you have any other questions, I'm happy to help!";

/**
 * Pick escalation fallback text to match the guest's message language (Latin vs Cyrillic heuristic).
 */
export function resolveGuestEscalationFallback(userMessage: string): string {
  const t = userMessage.trim();
  if (/[а-яА-ЯёЁ]/.test(t)) return GUEST_ESCALATION_FALLBACK_MESSAGE;
  if (/[a-zA-Z]/.test(t)) return GUEST_ESCALATION_FALLBACK_MESSAGE_EN;
  return GUEST_ESCALATION_FALLBACK_MESSAGE;
}

const LATIN_WORD = /[a-zA-Z]{3,}/;

/**
 * True when the guest clearly wrote in one script and the reply body is clearly in the other
 * (e.g. Russian guest, English-only assistant prose).
 */
export function guestReplyScriptMismatch(guestMessage: string, reply: string): boolean {
  const g = guestMessage.trim();
  const r = reply.trim();
  if (!g || !r) return false;
  const guestCyr = /[а-яА-ЯёЁ]/.test(g);
  const replyCyr = /[а-яА-ЯёЁ]/.test(r);
  const replyLatin = LATIN_WORD.test(r);
  const guestLatin = LATIN_WORD.test(g);
  if (guestCyr && replyLatin && !replyCyr) return true;
  if (!guestCyr && guestLatin && replyCyr && !replyLatin) return true;
  return false;
}

/** Short host-check phrases the model often returns in the wrong language. */
export function isLikelyEscalationGuestReply(reply: string): boolean {
  const t = reply.trim();
  if (!t) return false;
  if (assistantReplyIndicatesEscalationWithoutMarker(t)) return true;
  if (/\bI(?:'ll| will)\s+check\s+(?:this\s+)?with\s+the\s+host\b/i.test(t)) return true;
  if (/I'll\s+get\s+back\s+to\s+you\s+shortly/i.test(t)) return true;
  if (/уточню\s+(?:это\s+)?у\s+хозяин/i.test(t)) return true;
  if (/скоро\s+(?:отвечу|вернусь)/i.test(t) && /хозяин/i.test(t)) return true;
  const enNorm = t.replace(/\s+/g, ' ').toLowerCase();
  const ruNorm = t.replace(/\s+/g, ' ').toLowerCase();
  if (enNorm.includes(GUEST_ESCALATION_FALLBACK_MESSAGE_EN.slice(0, 48).toLowerCase())) return true;
  if (ruNorm.includes(GUEST_ESCALATION_FALLBACK_MESSAGE.slice(0, 36).toLowerCase())) return true;
  return false;
}

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

/**
 * The model is instructed to end with [ESCALATE] but often omits it while still echoing the
 * escalation phrase. Without this, `notifyStaff` stays false when KB looks "strong" and Telegram never fires.
 */
export function assistantReplyIndicatesEscalationWithoutMarker(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bcheck\s+(?:this\s+)?with\s+the\s+host\b/i.test(t)) return true;
  if (/уточню\s+(?:это\s+)?у\s+хозяин/i.test(t)) return true;
  if (/уточню\s+у\s+хозяин/i.test(t)) return true;
  return false;
}

/** Short hints so the model maps each KB block to the right topic (reduces cross-topic number misuse). */
const KB_CATEGORY_TOPIC_HINT: Record<string, string> = {
  checkin: 'check-in/check-out times and access windows — numbers here are times, NOT floor or flat number',
  wifi: 'Wi‑Fi and internet',
  rules: 'house rules',
  location: 'address, directions, floor/building only if explicitly stated here',
  neighborhood: 'area, shops, surroundings',
  parking: 'parking and transport',
  equipment: 'appliances and equipment in the unit',
  services: 'services and amenities',
  contacts: 'contacts and access details',
  safety: 'safety and emergencies',
  waste: 'trash and recycling',
  pets: 'pets policy',
  family: 'children and family',
  quiet: 'quiet hours and noise',
  other: 'general — still match topic before using any numbers',
};

export function formatKnowledgeBaseEntriesForAgent(
  entries: { title: string; content: string; category?: string | null }[],
): string {
  return entries
    .map((e) => {
      const raw = (e.category ?? 'other').trim().toLowerCase();
      const hint = KB_CATEGORY_TOPIC_HINT[raw] ?? KB_CATEGORY_TOPIC_HINT.other;
      return [`### ${e.title}`, `Category: ${raw} — ${hint}`, '', e.content].join('\n');
    })
    .join('\n\n---\n\n');
}

export function buildSystemPrompt(propertyName: string, knowledgeBase: string): string {
  return [
    `You are a helpful AI assistant for the rental property "${propertyName}".`,
    '',
    'NON-NEGOTIABLE: Every character you write to the guest must be in the same language as their latest message. Wrong language is a failure — even if the knowledge base is in another language, translate facts into the guest\'s language only.',
    '',
    'LANGUAGE — MANDATORY (always):',
    '- Identify the language of the guest\'s latest message (the question you are answering).',
    '- Your entire reply to the guest must be in that same language — every sentence, including lists and details.',
    '- If the guest wrote in English, reply only in English; if in Russian, only in Russian; apply the same rule for any other language.',
    '- The Knowledge Base section below may be written in a different language; still convey only those facts, translated faithfully into the guest\'s language. Never answer in the KB\'s language when it differs from the guest\'s.',
    '- If the guest mixes languages, use the language that clearly dominates the question.',
    '',
    'PRIMARY RULE — KNOWLEDGE BASE:',
    '- You may ONLY state facts that appear in the "Knowledge Base" section below.',
    '- If the guest\'s question is NOT fully answered by that text (missing details, different topic, or no matching entry), you MUST escalate — see ESCALATION below.',
    '- Never invent amenities, rules, prices, addresses, or policies.',
    '- Never guess from general world knowledge when the KB is silent on that point.',
    '',
    'TOPIC MATCHING — CRITICAL:',
    '- Each entry has a Category line. Use only entries whose topic matches the guest\'s question.',
    '- Numbers in check-in/check-out or time windows (e.g. "12-15", "14:00–16:00", "с 12 до 15") mean TIME, never floor, apartment number, or door code.',
    '- For floor (этаж), apartment number, or "which floor": the KB must explicitly state floor/этаж/квартира № (or equivalent). If that is missing, escalate — do NOT reuse numbers from unrelated categories.',
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
