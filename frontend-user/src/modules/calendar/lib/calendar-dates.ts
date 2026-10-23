import type { BookingWeekday } from '../../pricing/api';
import { WEEKDAYS, addDaysYmd, nightsCount } from '../../pricing/lib/pricing-ui';

/** «Открыть / закрыть даты на Booking»: form helpers (pure, tested in calendar-dates.spec.ts). */

export type DatesAction = 'open' | 'close';
/** Price of the opened nights: as Booking has it / one price / weekdays + weekend. */
export type PriceMode = 'keep' | 'one' | 'split';
/** Range length presets in days, like Booking's own availability planner. */
export const RANGE_PRESETS = [3, 30, 60, 90, 365] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number] | 'custom';
/** Days kept open by auto-extension. */
export const HORIZON_PRESETS = [30, 60, 90, 180, 365] as const;
/** The server refuses more in one run. */
export const MAX_RANGE_NIGHTS = 366;

/** Backend numbers days 0 = Sunday … 6 = Saturday. */
export const WEEKDAY_NUMBER: Record<BookingWeekday, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Last night (inclusive) of a preset that starts on `from`. */
export function presetLastNight(from: string, days: number): string {
  return addDaysYmd(from, days - 1);
}

/** «1 180», «1180,50», «900.5» → number with cents; empty / zero / junk → null. */
export function parsePrice(raw: string): number | null {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export type DatesFormState = {
  propertyId: string;
  action: DatesAction;
  /** Inclusive first night. */
  from: string;
  /** Inclusive last night. */
  to: string;
  weekdays: ReadonlySet<BookingWeekday>;
  priceMode: PriceMode;
  price: string;
  weekendPrice: string;
  /** With a price: also re-price nights that are open already (otherwise only closed nights change). */
  repriceOpen: boolean;
};

/** What the server takes: POST /calendar-dates/preview | apply. `dateTo` is exclusive. */
export type DatesRequestBody = {
  propertyId: string;
  action: DatesAction;
  dateFrom: string;
  dateTo: string;
  weekdays?: number[];
  price?: number;
  weekendPrice?: number;
  onlyClosed?: boolean;
};

export type DatesFormError = 'property' | 'dates' | 'past' | 'tooLong' | 'tooFar' | 'weekdays' | 'price' | 'weekendPrice';

/** Last night that may be opened: RentAI pushes availability `horizonDays` ahead, today included. */
export function lastAllowedNight(today: string, horizonDays: number): string {
  return addDaysYmd(today, horizonDays - 1);
}

export function buildDatesRequest(
  s: DatesFormState,
  today: string,
  /** Inclusive; see `lastAllowedNight`. */
  lastNight?: string,
): { ok: true; body: DatesRequestBody } | { ok: false; error: DatesFormError } {
  if (!s.propertyId) return { ok: false, error: 'property' };
  if (!s.from || !s.to || s.from > s.to) return { ok: false, error: 'dates' };
  if (s.from < today) return { ok: false, error: 'past' };
  if (nightsCount(s.from, s.to) > MAX_RANGE_NIGHTS) return { ok: false, error: 'tooLong' };
  if (lastNight && s.to > lastNight) return { ok: false, error: 'tooFar' };
  if (s.weekdays.size === 0) return { ok: false, error: 'weekdays' };
  const body: DatesRequestBody = {
    propertyId: s.propertyId,
    action: s.action,
    dateFrom: s.from,
    dateTo: addDaysYmd(s.to, 1),
  };
  if (s.weekdays.size < WEEKDAYS.length) {
    body.weekdays = [...s.weekdays].map((d) => WEEKDAY_NUMBER[d]).sort((a, b) => a - b);
  }
  if (s.action === 'open' && s.priceMode !== 'keep') {
    const price = parsePrice(s.price);
    if (price == null) return { ok: false, error: 'price' };
    body.price = price;
    if (s.priceMode === 'split') {
      const weekend = parsePrice(s.weekendPrice);
      if (weekend == null) return { ok: false, error: 'weekendPrice' };
      body.weekendPrice = weekend;
    }
    if (!s.repriceOpen) body.onlyClosed = true;
  }
  return { ok: true, body };
}

/** Same request = the shown preview still describes it. */
export function requestKey(body: DatesRequestBody): string {
  return JSON.stringify([
    body.propertyId,
    body.action,
    body.dateFrom,
    body.dateTo,
    body.weekdays ?? null,
    body.price ?? null,
    body.weekendPrice ?? null,
    body.onlyClosed ?? false,
  ]);
}

/** `closed`: a re-pricing run («Цены → базовая цена») leaves nights closed on Booking alone. */
export type SkipReason = 'crm' | 'booked' | 'belowMin' | 'missing' | 'weekday' | 'unchanged' | 'noPrice' | 'keepClosed' | 'closed';
const SKIP_ORDER: readonly SkipReason[] = ['booked', 'crm', 'belowMin', 'unchanged', 'weekday', 'noPrice', 'keepClosed', 'closed', 'missing'];

/** Non-zero skip reasons, most telling first. */
export function skippedList(skipped: Partial<Record<SkipReason, number>>): [SkipReason, number][] {
  return SKIP_ORDER.map((r) => [r, skipped[r] ?? 0] as [SkipReason, number]).filter(([, n]) => n > 0);
}

/** «~2 мин» style rounding for the run estimate: whole minutes from one minute up. */
export function estimateParts(seconds: number): { unit: 'sec' | 'min'; value: number } {
  if (seconds < 60) return { unit: 'sec', value: Math.max(5, Math.ceil(seconds / 5) * 5) };
  return { unit: 'min', value: Math.ceil(seconds / 60) };
}
