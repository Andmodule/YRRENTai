import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en', 'pl', 'es', 'de'],
  defaultLocale: 'ru',
});
