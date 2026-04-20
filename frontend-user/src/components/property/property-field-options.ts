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
