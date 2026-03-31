'use client';

import { useLocale } from 'next-intl';
import { ru, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';

const localeMap: Record<string, Locale> = { ru, en: enUS };

export function useDateLocale(): Locale {
  const locale = useLocale();
  return localeMap[locale] ?? enUS;
}
