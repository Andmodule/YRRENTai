import { routing } from '@/i18n/routing';

export function getLocaleFromPathname(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (segment && routing.locales.includes(segment as (typeof routing.locales)[number])) {
    return segment;
  }
  return routing.defaultLocale;
}

export function isAuthPath(pathname: string): boolean {
  return pathname.includes('/login') || pathname.includes('/register');
}

/** Telegram Mini App routes: opened inside Telegram WebView; auth uses `initData` instead of password. */
export function isTmaPath(pathname: string): boolean {
  return pathname.includes('/tma');
}
