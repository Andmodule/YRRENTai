/**
 * Multilingual safe response templates for fallback turns.
 * Used when LLM is unavailable, circuit breaker fires, or policy forces immediate response.
 *
 * Languages: ru, en (extendable — add key to ResponseKey + phrases below)
 */

export type ResponseKey =
  | 'emergency'
  | 'hold'
  | 'transfer'
  | 'low_confidence'
  | 'no_match'
  | 'after_hours'
  | 'complaint_received'
  | 'max_turns'
  | 'llm_failure'
  | 'welcome';

type LangMap = Record<string, string>;
type TemplateMap = Record<ResponseKey, LangMap>;

const TEMPLATES: TemplateMap = {
  emergency: {
    ru: 'Это экстренная ситуация? Немедленно звоните 112. Я соединяю вас с менеджером прямо сейчас.',
    en: 'Is this an emergency? Please call 112 immediately. I am connecting you with a manager right now.',
  },
  hold: {
    ru: 'Секунду, уточняю информацию.',
    en: 'One moment, let me check that for you.',
  },
  transfer: {
    ru: 'Соединяю вас с нашим менеджером. Оставайтесь на линии.',
    en: 'Connecting you with our manager. Please hold the line.',
  },
  low_confidence: {
    ru: 'Я не уверен в правильности ответа и хочу уточнить с менеджером. Один момент.',
    en: 'I want to make sure I give you the right answer — let me connect you with a manager.',
  },
  no_match: {
    ru: 'К сожалению, я не нашёл нужной информации. Могу соединить с менеджером.',
    en: 'I could not find the information you need. I can connect you with a manager.',
  },
  after_hours: {
    ru: 'Сейчас нерабочее время. Оставьте сообщение или свяжитесь с нами утром. Экстренные вопросы — менеджер доступен.',
    en: 'Our office is currently closed. Please leave a message or contact us in the morning. For emergencies, a manager is available.',
  },
  complaint_received: {
    ru: 'Я понимаю вашу озабоченность и хочу убедиться, что ваш вопрос будет решён. Соединяю с менеджером.',
    en: 'I understand your concern and want to make sure it gets resolved. Let me connect you with a manager.',
  },
  max_turns: {
    ru: 'Позвольте соединить вас с нашим менеджером, который сможет помочь полнее.',
    en: 'Let me connect you with our manager who can assist you more fully.',
  },
  llm_failure: {
    ru: 'Секунду, у меня небольшая техническая пауза. Уточняю и возвращаюсь.',
    en: 'One moment, I am experiencing a brief technical issue. I will be right back.',
  },
  welcome: {
    ru: 'Добрый день! Я голосовой ассистент по аренде. Чем могу помочь?',
    en: 'Hello! I am the rental voice assistant. How can I help you today?',
  },
};

/**
 * Returns a localised safe response for the given key.
 * Falls back to 'en' if the requested language is not found.
 */
export function getSafeResponse(key: ResponseKey, language: string): string {
  const lang = (language.split('-')[0] ?? 'ru').toLowerCase();
  const template: LangMap | undefined = TEMPLATES[key];
  if (!template) return '';
  return template[lang] ?? template['en'] ?? template['ru'] ?? '';
}

/**
 * Returns all safe responses for a language (for seeding / preview).
 */
export function getAllSafeResponses(language: string): Record<ResponseKey, string> {
  const lang = (language.split('-')[0] ?? 'ru').toLowerCase();
  return Object.fromEntries(
    Object.entries(TEMPLATES).map(([key, map]) => [key, (map as LangMap)[lang] ?? (map as LangMap)['en'] ?? '']),
  ) as Record<ResponseKey, string>;
}
