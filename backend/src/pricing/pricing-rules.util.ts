/**
 * Pure helpers for «Цены → Автоправила».
 *
 * A rule is a ladder of Booking «Last-minute» deals (one PricePromotionEntity per step, all sharing
 * `externalMeta.rule.groupId`). Booking never adds such deals up — the guest sees the highest one — so the
 * discount grows the closer the arrival is. No schema change: everything lives in `externalMeta`.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { addDaysYmd } from './pricing-math.util';

export type LastMinuteUnit = 'day' | 'hour';
export type LastMinuteSpec = { unit: LastMinuteUnit; value: number };
/** Hours of the day in the property time zone: start inclusive, end exclusive, 0 ≤ start < end ≤ 24. */
export type BookTimeSpec = { start: number; end: number };

export type RuleMeta = {
  groupId: string;
  /** Rule name (steps get their own descriptive name). */
  name: string;
  stepIndex: number;
  horizonMonths: number;
};

export type RuleStepMeta = {
  rule: RuleMeta;
  lastMinute: LastMinuteSpec;
  bookTime: BookTimeSpec | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Booking accepts 1–1000 for both units. */
export function parseLastMinute(raw: unknown): LastMinuteSpec | null {
  if (!isRecord(raw)) return null;
  const unit = raw.unit;
  const value = Number(raw.value);
  if ((unit !== 'day' && unit !== 'hour') || !Number.isInteger(value) || value < 1 || value > 1000) {
    return null;
  }
  return { unit, value };
}

export function parseBookTime(raw: unknown): BookTimeSpec | null {
  if (!isRecord(raw)) return null;
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > 24 || start >= end) return null;
  return { start, end };
}

/** Rule metadata of a promotion; null for ordinary discounts and for broken metadata. */
export function parseRuleStepMeta(externalMeta: unknown): RuleStepMeta | null {
  if (!isRecord(externalMeta) || !isRecord(externalMeta.rule)) return null;
  const r = externalMeta.rule;
  const lastMinute = parseLastMinute(externalMeta.lastMinute);
  if (typeof r.groupId !== 'string' || !r.groupId || !lastMinute) return null;
  return {
    rule: {
      groupId: r.groupId,
      name: typeof r.name === 'string' ? r.name : '',
      stepIndex: Number.isInteger(r.stepIndex) ? (r.stepIndex as number) : 0,
      horizonMonths: Number.isInteger(r.horizonMonths) ? (r.horizonMonths as number) : 6,
    },
    lastMinute,
    bookTime: parseBookTime(externalMeta.bookTime),
  };
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** yyyy-MM-dd plus whole months; the day is clamped to the end of a shorter month. */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Last stay date (inclusive) of a rule that starts on `from` and runs `months` months. */
export function ruleStayTo(from: string, months: number): string {
  return addDaysYmd(addMonthsYmd(from, months), -1);
}

/** Is `now` inside the booking-time window, hours counted in the property time zone? */
export function isBookTimeNow(
  bookTime: BookTimeSpec | null | undefined,
  timezone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!bookTime) return true;
  let hour: number;
  try {
    hour = Number(formatInTimeZone(now, timezone?.trim() || 'UTC', 'H'));
  } catch {
    hour = Number(formatInTimeZone(now, 'UTC', 'H'));
  }
  return hour >= bookTime.start && hour < bookTime.end;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function hhmm(hour: number): string {
  return `${hour}:00`;
}

/** Human name of a step kept in RentAI (Booking only sees the short marker). */
export function ruleStepName(lastMinute: LastMinuteSpec, bookTime: BookTimeSpec | null): string {
  const n = lastMinute.value;
  const before =
    lastMinute.unit === 'day'
      ? `За ${n} ${plural(n, 'день', 'дня', 'дней')} до заезда`
      : `За ${n} ${plural(n, 'час', 'часа', 'часов')} до заезда`;
  return bookTime ? `${before}, бронь ${hhmm(bookTime.start)}–${hhmm(bookTime.end)}` : before;
}

const STATE_ORDER = ['error', 'skipped', 'pending', 'dry_run', 'on', 'off'] as const;

/** Worst state wins: what a person should look at first. */
export function worstTargetState<T extends string>(states: readonly T[]): T | null {
  for (const s of STATE_ORDER) {
    if ((states as readonly string[]).includes(s)) return s as unknown as T;
  }
  return states[0] ?? null;
}
