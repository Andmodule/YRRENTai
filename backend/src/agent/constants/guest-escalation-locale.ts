import { francAll } from 'franc';
import {
  GUEST_ESCALATION_FALLBACK_MESSAGE,
  GUEST_ESCALATION_FALLBACK_MESSAGE_DE,
  GUEST_ESCALATION_FALLBACK_MESSAGE_EN,
  GUEST_ESCALATION_FALLBACK_MESSAGE_ES,
  GUEST_ESCALATION_FALLBACK_MESSAGE_PL,
  GUEST_ESCALATION_FALLBACK_MESSAGE_UK,
} from './guest-escalation-messages';
import { detectGuestCyrillicLanguage } from './guest-message-language';

/** ISO 639-3 codes franc uses; keep aligned with {@link MESSAGE_BY_FRANC_CODE}. */
const FRANC_LATIN_BASE = ['eng', 'pol'] as const;

const MESSAGE_BY_FRANC_CODE: Record<string, string> = {
  eng: GUEST_ESCALATION_FALLBACK_MESSAGE_EN,
  pol: GUEST_ESCALATION_FALLBACK_MESSAGE_PL,
  deu: GUEST_ESCALATION_FALLBACK_MESSAGE_DE,
  spa: GUEST_ESCALATION_FALLBACK_MESSAGE_ES,
};

/** Common English tokens in guest messages (short-text disambiguation vs Polish in franc). */
const ENGLISH_HINT_WORDS = new Set([
  'the',
  'and',
  'you',
  'your',
  'are',
  'is',
  "isn't",
  "aren't",
  "don't",
  "doesn't",
  'does',
  'have',
  'has',
  'with',
  'this',
  'that',
  'what',
  'when',
  'where',
  'how',
  'why',
  'can',
  'could',
  'would',
  'will',
  'please',
  'thanks',
  'thank',
  'hello',
  'hi',
  'hey',
  'there',
  'here',
  'from',
  'any',
  'about',
  'into',
  'wifi',
  'password',
  'check',
  'booking',
  'early',
  'late',
  'room',
  'apartment',
  'flat',
  'property',
  'rental',
  'stay',
  'guest',
]);

const GERMAN_HINT_RE =
  /\b(?:ich|du|sie|wir|und|der|die|das|den|dem|ein|eine|einen|nicht|mit|von|zu|auf|ist|sind|war|waren|guten|tag|hallo|bitte|danke|wo|auch|noch|parkplatz|zimmer|buchung|früh|spät)\b/i;

const SPANISH_HINT_RE =
  /\b(?:hola|gracias|por\s+favor|buenos|buenas|cómo|como|dónde|donde|qué|que|hay|para|usted|habitaci[oó]n|llegada|salida|reserva)\b/i;

function countEnglishHints(text: string): number {
  const words = text.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  return words.filter((w) => ENGLISH_HINT_WORDS.has(w)).length;
}

/**
 * Restrict franc's Latin candidates so unrelated ISO codes (e.g. spa/deu) do not win on Polish ASCII.
 */
function buildFrancLatinOnlyList(text: string): string[] {
  const only = new Set<string>(FRANC_LATIN_BASE);
  if (GERMAN_HINT_RE.test(text)) {
    only.add('deu');
  }
  if (SPANISH_HINT_RE.test(text) || /[ñ¿¡Ñ]/.test(text)) {
    only.add('spa');
  }
  return [...only];
}

/**
 * Guest-visible escalation line in the same language as the guest message when possible.
 * Uses franc (trigram) with a production-safe whitelist and script/lexical priors — short Latin
 * strings are ambiguous for any statistical detector; we narrow the candidate set and apply
 * minimal English disambiguation when franc picks Polish.
 */
export function resolveGuestEscalationFallback(userMessage: string): string {
  const t = userMessage.trim();
  if (!t) {
    return GUEST_ESCALATION_FALLBACK_MESSAGE_EN;
  }

  if (/[іїєґІЇЄҐ]/.test(t)) {
    return GUEST_ESCALATION_FALLBACK_MESSAGE_UK;
  }
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(t)) {
    return GUEST_ESCALATION_FALLBACK_MESSAGE_PL;
  }
  if (/[äöüßÄÖÜ]/.test(t)) {
    return GUEST_ESCALATION_FALLBACK_MESSAGE_DE;
  }
  if (/[ñ¿¡Ñ]/.test(t)) {
    return GUEST_ESCALATION_FALLBACK_MESSAGE_ES;
  }

  if (/[а-яА-ЯёЁ]/.test(t)) {
    const lang = detectGuestCyrillicLanguage(t);
    return lang === 'uk' ? GUEST_ESCALATION_FALLBACK_MESSAGE_UK : GUEST_ESCALATION_FALLBACK_MESSAGE;
  }

  const onlyLatin = buildFrancLatinOnlyList(t);
  const ranked = francAll(t, { only: onlyLatin, minLength: 1 });
  let code = ranked[0]?.[0] ?? 'und';

  if (code === 'pol' && countEnglishHints(t) >= 2) {
    code = 'eng';
  }

  const message = MESSAGE_BY_FRANC_CODE[code];
  return message ?? GUEST_ESCALATION_FALLBACK_MESSAGE_EN;
}
