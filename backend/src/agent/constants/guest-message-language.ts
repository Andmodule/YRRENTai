/** Ukrainian-only Cyrillic letters (not used in standard Russian). */
export const UKRAINIAN_ONLY_LETTERS_RE = /[іїєґІЇЄҐ]/;

export const CYRILLIC_RE = /[а-яА-ЯёЁ]/;

export type GuestCyrillicLanguage = 'ru' | 'uk';

/** Distinctive Ukrainian words/phrases (substring match — JS \\b does not work for Cyrillic). */
const UKRAINIAN_HINTS = [
  'мені',
  'потрібно',
  'дякую',
  'відповід',
  'найближч',
  'повернуся',
  'будь ласка',
  'будь-ласка',
  'доброго дня',
  'добрий день',
  'паркування',
  'скажіть',
  'підкажіть',
  'де знаходиться',
  'уточніть',
] as const;

const RUSSIAN_HINTS = [
  'мне',
  'нужно',
  'спасибо',
  'ответ',
  'ближайш',
  'вернусь',
  'пожалуйста',
  'добрый день',
  'парковк',
  'скажите',
  'подскажите',
  'где находится',
  'уточнить',
  'есть ли',
] as const;

function countHintHits(hints: readonly string[], text: string): number {
  const lower = text.toLowerCase();
  return hints.filter((hint) => lower.includes(hint)).length;
}

/**
 * Best-effort Russian vs Ukrainian for Cyrillic guest text.
 * Defaults to Russian when there are no Ukrainian-only letters or clear Ukrainian lexical hints.
 */
export function detectGuestCyrillicLanguage(text: string): GuestCyrillicLanguage | null {
  const t = text.trim();
  if (!CYRILLIC_RE.test(t)) {
    return null;
  }

  if (UKRAINIAN_ONLY_LETTERS_RE.test(t)) {
    return 'uk';
  }

  const ukHits = countHintHits(UKRAINIAN_HINTS, t);
  const ruHits = countHintHits(RUSSIAN_HINTS, t);

  if (ukHits > ruHits && ukHits >= 1) {
    return 'uk';
  }

  return 'ru';
}

/** True when reply text clearly uses Ukrainian (letters or vocabulary). */
export function replySignalsUkrainian(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  if (UKRAINIAN_ONLY_LETTERS_RE.test(t)) {
    return true;
  }
  return countHintHits(UKRAINIAN_HINTS, t) >= 1;
}

/** True when reply is Cyrillic and reads as Russian, not Ukrainian. */
export function replySignalsRussian(text: string): boolean {
  const t = text.trim();
  if (!t || !CYRILLIC_RE.test(t)) {
    return false;
  }
  return !replySignalsUkrainian(t);
}

/**
 * True when guest and reply are both Cyrillic but different Slavic languages (ru ↔ uk).
 */
export function guestCyrillicLanguageMismatch(guestMessage: string, reply: string): boolean {
  const guestLang = detectGuestCyrillicLanguage(guestMessage);
  if (!guestLang) {
    return false;
  }

  if (guestLang === 'ru' && replySignalsUkrainian(reply)) {
    return true;
  }

  if (guestLang === 'uk' && replySignalsRussian(reply)) {
    return true;
  }

  return false;
}
