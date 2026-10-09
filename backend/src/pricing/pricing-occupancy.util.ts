/**
 * «Цены → Заполненность»: how full a property is over the coming days and which discount to suggest.
 * Pure helpers — no database, no Booking.
 *
 * The thresholds are the manager's own («сдано меньше X% → скидка Y%») and are edited in the UI;
 * the defaults below are only a starting point.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { addDaysYmd } from './pricing-math.util';

export type OccupancyTier = {
  /** The tier applies while occupancy is BELOW this percent of the nights. */
  belowPct: number;
  discountPct: number;
};

export type OccupancySettings = {
  /** How many nights ahead are counted, starting today (property time zone). */
  horizonDays: number;
  tiers: OccupancyTier[];
};

export const OCCUPANCY_HORIZON_MIN = 7;
/** Same ceiling as the minimum-price check window: prices further ahead are not read from Booking. */
export const OCCUPANCY_HORIZON_MAX = 120;
export const OCCUPANCY_MAX_TIERS = 6;

export const DEFAULT_OCCUPANCY_SETTINGS: OccupancySettings = {
  horizonDays: 30,
  tiers: [
    { belowPct: 10, discountPct: 12 },
    { belowPct: 20, discountPct: 8 },
    { belowPct: 30, discountPct: 5 },
  ],
};

/** Bookings in these statuses do not occupy a night. */
export const FREE_BOOKING_STATUSES = ['CANCELLED', 'DECLINED', 'NO_SHOW'] as const;

/** Lowest threshold first — the order tiers are matched in. */
export function sortTiers(tiers: readonly OccupancyTier[]): OccupancyTier[] {
  return [...tiers].sort((a, b) => a.belowPct - b.belowPct);
}

/** null when the tiers can be used as they are; otherwise what is wrong, in one line. */
export function tiersProblem(tiers: readonly OccupancyTier[]): string | null {
  if (tiers.length < 1 || tiers.length > OCCUPANCY_MAX_TIERS) {
    return `Нужно от 1 до ${OCCUPANCY_MAX_TIERS} порогов`;
  }
  for (const t of tiers) {
    if (!Number.isInteger(t.belowPct) || t.belowPct < 1 || t.belowPct > 100) {
      return 'Порог заполненности — целое число от 1 до 100%';
    }
    if (!Number.isInteger(t.discountPct) || t.discountPct < 1 || t.discountPct > 99) {
      return 'Скидка — целое число от 1 до 99%';
    }
  }
  const sorted = sortTiers(tiers);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.belowPct === sorted[i - 1]!.belowPct) {
      return `Порог ${sorted[i]!.belowPct}% указан дважды`;
    }
    // An emptier property must never get a smaller discount than a fuller one.
    if (sorted[i]!.discountPct > sorted[i - 1]!.discountPct) {
      return `Чем меньше сдано, тем больше скидка: при пороге ${sorted[i - 1]!.belowPct}% скидка не может быть меньше, чем при ${sorted[i]!.belowPct}%`;
    }
  }
  return null;
}

/**
 * The tier for `booked` nights out of `total`: the lowest threshold the occupancy is still below.
 * Compared as a fraction, so 3 of 30 nights (exactly 10%) is NOT «below 10%».
 */
export function suggestTier(
  tiers: readonly OccupancyTier[],
  booked: number,
  total: number,
): OccupancyTier | null {
  if (!(total > 0)) return null;
  return sortTiers(tiers).find((t) => booked * 100 < t.belowPct * total) ?? null;
}

/** Whole percent for display. */
export function occupancyPct(booked: number, total: number): number {
  return total > 0 ? Math.round((booked * 100) / total) : 0;
}

/** Calendar day of an instant in the property time zone; UTC for an unknown zone. */
export function ymdInTz(date: Date, tz: string | null | undefined): string {
  try {
    return formatInTimeZone(date, tz?.trim() || 'UTC', 'yyyy-MM-dd');
  } catch {
    return formatInTimeZone(date, 'UTC', 'yyyy-MM-dd');
  }
}

/**
 * How many of the `days` nights starting at `from` are taken. A stay takes its check-in day and every
 * day up to, not including, the check-out day; overlapping stays (overbooking) count a night once.
 */
export function bookedNights(
  stays: ReadonlyArray<{ checkIn: string; checkOut: string }>,
  from: string,
  days: number,
): number {
  const endExclusive = addDaysYmd(from, days);
  const taken = new Set<string>();
  for (const s of stays) {
    let d = s.checkIn < from ? from : s.checkIn;
    const stop = s.checkOut < endExclusive ? s.checkOut : endExclusive;
    for (let i = 0; d < stop && i < 400; i++) {
      taken.add(d);
      d = addDaysYmd(d, 1);
    }
  }
  return taken.size;
}
