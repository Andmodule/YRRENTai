import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale routing only. SUPERADMIN is enforced in `AdminAuthGate` (browser + cookies),
 * not here — Edge middleware cannot reliably forward session cookies to same-origin API.
 */
export default createMiddleware(routing);

export const config = {
  matcher: ['/', '/(ru|en|pl|es|de)/:path*'],
};
