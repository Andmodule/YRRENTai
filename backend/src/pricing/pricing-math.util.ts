/**
 * Pure helpers for «Цены → Скидки»: dates in the property timezone, Genius-aware guest price,
 * minimum-price protection and overlaps between Booking promotions.
 *
 * Booking rules (developers.booking.com, Promotions FAQ / Partner Hub, checked 2026-10-04):
 * - promotions of the same category (basic / last-minute / early booker) never add up —
 *   the guest sees only the highest discount;
 * - Genius applies first, then the deal, one after another (multiplicative);
 * - a Mobile / Country rate from the extranet is another category and stacks on top of both
 *   (checked 2026-10-08) — see pricing-targeting.util.ts.
 */

import { createHash } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import {
  BOOKING_WEEKDAYS,
  type BookingWeekday,
} from '../integrations/zodomus/zodomus-promotions.util';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: unknown): s is string {
  return typeof s === 'string' && YMD.test(s);
}

/** Today (yyyy-MM-dd) in the property timezone; falls back to UTC for an unknown zone. */
export function todayInTz(tz: string | null | undefined, now: Date = new Date()): string {
  try {
    return formatInTimeZone(now, tz?.trim() || 'UTC', 'yyyy-MM-dd');
  } catch {
    return formatInTimeZone(now, 'UTC', 'yyyy-MM-dd');
  }
}

function utcNoon(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(utcNoon(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive number of nights from `from` to `to`. */
export function nightsCount(from: string, to: string): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / 86_400_000) + 1;
}

export function weekdayOf(ymd: string): BookingWeekday {
  // getUTCDay: 0 = Sunday … 6 = Saturday
  const idx = new Date(utcNoon(ymd)).getUTCDay();
  return BOOKING_WEEKDAYS[(idx + 6) % 7] as BookingWeekday;
}

/** Dedupe + Monday-first order; all seven (or none) → null = «все дни». */
export function normalizeWeekdays(
  input: readonly string[] | null | undefined,
): BookingWeekday[] | null {
  if (!input || input.length === 0) return null;
  const set = new Set(input.map((s) => s.slice(0, 3).toLowerCase()));
  const out = BOOKING_WEEKDAYS.filter((d) => set.has(d.toLowerCase()));
  if (out.length === 0 || out.length === BOOKING_WEEKDAYS.length) return null;
  return out;
}

/** Nights in [from, to] (inclusive) that match the weekday filter. */
export function nightsInRange(
  from: string,
  to: string,
  weekdays: readonly BookingWeekday[] | null,
): string[] {
  const out: string[] = [];
  const allow = weekdays && weekdays.length > 0 ? new Set(weekdays) : null;
  let cur = from;
  for (let i = 0; i < 800 && cur <= to; i++) {
    if (!allow || allow.has(weekdayOf(cur))) out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

/**
 * Lowest price a guest can see: Booking applies Genius, then the deal, then the property's
 * Mobile / Country rate (`targetingPct`), one after another.
 */
export function guestPriceAfter(
  price: number,
  geniusPct: number | null | undefined,
  discountPct: number,
  targetingPct?: number | null,
): number {
  const g = Math.max(0, geniusPct ?? 0);
  const m = Math.max(0, targetingPct ?? 0);
  return (((((price * (100 - g)) / 100) * (100 - discountPct)) / 100) * (100 - m)) / 100;
}

export function isBelowMinPrice(
  price: number,
  geniusPct: number | null | undefined,
  discountPct: number,
  minPrice: number | null | undefined,
  targetingPct?: number | null,
): boolean {
  if (!minPrice || minPrice <= 0) return false;
  return guestPriceAfter(price, geniusPct, discountPct, targetingPct) < minPrice;
}

/**
 * Largest whole discount (%) that keeps the lowest guest price ≥ minPrice.
 * null when no minimum is set; ≤ 0 means no discount is possible.
 */
export function safeDiscountPct(
  price: number,
  geniusPct: number | null | undefined,
  minPrice: number | null | undefined,
  targetingPct?: number | null,
): number | null {
  if (!minPrice || minPrice <= 0 || !(price > 0)) return null;
  const base = guestPriceAfter(price, geniusPct, 0, targetingPct);
  return Math.floor((1 - minPrice / base) * 100 + 1e-9);
}

export type DateRange = { from: string; to: string };

export function intersectRanges(a: DateRange, b: DateRange): DateRange | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

export type ExistingPromotionLite = {
  promotionId: string;
  name: string;
  discountPct: number;
  source: 'rentai' | 'booking';
  from: string;
  to: string;
  /** Properties where it is currently on. */
  propertyIds: string[];
};

export type OverlapInfo = {
  promotionId: string;
  name: string;
  discountPct: number;
  source: 'rentai' | 'booking';
  from: string;
  to: string;
  propertyIds: string[];
  /** Which discount the guest will see on the overlap (Booking shows only the highest). */
  visible: 'new' | 'existing' | 'equal';
};

export function findOverlaps(
  spec: { from: string; to: string; discountPct: number; propertyIds: readonly string[] },
  existing: readonly ExistingPromotionLite[],
): OverlapInfo[] {
  const wanted = new Set(spec.propertyIds);
  const out: OverlapInfo[] = [];
  for (const e of existing) {
    const range = intersectRanges(spec, e);
    if (!range) continue;
    const propertyIds = e.propertyIds.filter((id) => wanted.has(id));
    if (propertyIds.length === 0) continue;
    out.push({
      promotionId: e.promotionId,
      name: e.name,
      discountPct: e.discountPct,
      source: e.source,
      from: range.from,
      to: range.to,
      propertyIds,
      visible:
        spec.discountPct > e.discountPct
          ? 'new'
          : spec.discountPct < e.discountPct
            ? 'existing'
            : 'equal',
    });
  }
  return out;
}

/** Stable fingerprint of what was sent to Booking — a change means «recreate the promotion». */
export function promotionHash(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, parts[k]]));
  return createHash('sha1').update(canonical).digest('hex');
}

/** Marker in the Booking promotion name — lets a retry find a promotion created by a lost response. */
export function promotionMarker(targetId: string, version: number): string {
  // «RentAI 1a2b3c4d-1» — 17 ASCII chars, fits the Zodomus 20-char name limit up to version 999.
  return `RentAI ${targetId.replace(/-/g, '').slice(0, 8)}-${version}`;
}

const MARKER_RE = /^RentAI [0-9a-f]{8}-\d+$/i;

export function hasRentaiMarker(name: string | null | undefined): boolean {
  return !!name && MARKER_RE.test(name.trim());
}

/** Minor units (integer) ↔ major units with 2 decimals. */
export function toMinor(major: number): number {
  return Math.round(major * 100);
}

export function toMajor(minor: number | null | undefined): number | null {
  return minor === null || minor === undefined ? null : minor / 100;
}
