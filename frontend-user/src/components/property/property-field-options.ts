/** Default for new properties (Poland). */
export const DEFAULT_PROPERTY_TIMEZONE = 'Europe/Warsaw';

export const TIMEZONES = [
  'UTC',
  'Europe/Moscow',
  'Europe/Minsk',
  'Europe/Kiev',
  DEFAULT_PROPERTY_TIMEZONE,
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'RUB', label: 'RUB — Russian Ruble' },
  { code: 'PLN', label: 'PLN — Polish Złoty' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'AED', label: 'AED — UAE Dirham' },
  { code: 'THB', label: 'THB — Thai Baht' },
  { code: 'TRY', label: 'TRY — Turkish Lira' },
] as const;

/**
 * ISO 4217 codes used for calendar OTA rates / direct bookings.
 * Matches Zodomus `currencyCode` (3-letter); złoty = PLN.
 */
export const OTA_RATE_CURRENCIES = [
  { code: 'PLN', label: 'PLN — złoty' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'RUB', label: 'RUB — Russian Ruble' },
] as const;

export type OtaRateCurrencyCode = (typeof OTA_RATE_CURRENCIES)[number]['code'];

const OTA_RATE_CURRENCY_SET = new Set<string>(OTA_RATE_CURRENCIES.map((c) => c.code));

/** Pick an allowed OTA currency; default PLN (primary market). */
export function resolveOtaRateCurrency(raw?: string | null): OtaRateCurrencyCode {
  const code = raw?.trim().toUpperCase() ?? '';
  if (OTA_RATE_CURRENCY_SET.has(code)) return code as OtaRateCurrencyCode;
  return 'PLN';
}
