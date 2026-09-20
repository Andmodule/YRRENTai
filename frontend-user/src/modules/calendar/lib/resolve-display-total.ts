/**
 * Display total for calendar booking hover / detail.
 * Prefer CRM total; for OTA zeros fall back to channel nightly rack
 * (prefer "from"/cheapest eligible, then Standard).
 */

/** Sum otaNightlyPrices for exclusive checkout nights; null if any night missing. */
export function sumOtaNightlyPrices(
  prices: Record<string, number> | undefined,
  checkInYmd: string,
  checkOutYmd: string,
): number | null {
  if (!prices || !checkInYmd || !checkOutYmd || checkInYmd >= checkOutYmd) return null;
  let total = 0;
  let cur = checkInYmd;
  while (cur < checkOutYmd) {
    const p = prices[cur];
    if (p == null || !(p > 0)) return null;
    total += p;
    const parts = cur.split('-').map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y == null || m == null || d == null) return null;
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    if (total > 1e9) break;
  }
  return Math.round(total * 100) / 100;
}

export function resolveDisplayTotalMajor(
  totalPrice: number,
  checkInYmd: string,
  checkOutYmd: string,
  otaNightlyPrices?: Record<string, number>,
  otaNightlyPricesFrom?: Record<string, number>,
): number | null {
  if (Number.isFinite(totalPrice) && totalPrice > 0) {
    return totalPrice;
  }
  const fromSum = sumOtaNightlyPrices(otaNightlyPricesFrom, checkInYmd, checkOutYmd);
  if (fromSum != null) return fromSum;
  return sumOtaNightlyPrices(otaNightlyPrices, checkInYmd, checkOutYmd);
}

/** Prefer booking currency; fall back to property / OTA currency when invalid or missing. */
export function resolveDisplayCurrency(
  bookingCurrency: string | null | undefined,
  fallbackCurrency?: string | null,
): string {
  const primary = typeof bookingCurrency === 'string' ? bookingCurrency.trim().toUpperCase() : '';
  if (/^[A-Z]{3}$/.test(primary)) return primary;
  const fallback =
    typeof fallbackCurrency === 'string' ? fallbackCurrency.trim().toUpperCase() : '';
  if (/^[A-Z]{3}$/.test(fallback)) return fallback;
  return 'USD';
}

export function formatDisplayTotal(
  totalPrice: number,
  currency: string,
  checkInYmd: string,
  checkOutYmd: string,
  otaNightlyPrices: Record<string, number> | undefined,
  unavailableLabel: string,
  otaNightlyPricesFrom?: Record<string, number>,
  fallbackCurrency?: string | null,
): string {
  const major = resolveDisplayTotalMajor(
    totalPrice,
    checkInYmd,
    checkOutYmd,
    otaNightlyPrices,
    otaNightlyPricesFrom,
  );
  if (major == null) return unavailableLabel;
  const code = resolveDisplayCurrency(currency, fallbackCurrency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${code}`;
  }
}
