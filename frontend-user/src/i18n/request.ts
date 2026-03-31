import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/** Merge locale file over English so missing keys (e.g. new calendar strings) fall back to `en.json`. */
function deepMerge<T extends Record<string, unknown>>(base: T, override: T): T {
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      (out as Record<string, unknown>)[key] = deepMerge(
        bv as Record<string, unknown>,
        ov as Record<string, unknown>,
      );
    } else {
      (out as Record<string, unknown>)[key] = ov;
    }
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as typeof routing.locales[number])) {
    locale = routing.defaultLocale;
  }

  const en = (await import('../messages/en.json')).default as Record<string, unknown>;
  let messages: Record<string, unknown> = en;
  if (locale !== 'en') {
    const localeMessages = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;
    messages = deepMerge(en, localeMessages);
  }

  return {
    locale,
    messages,
  };
});
