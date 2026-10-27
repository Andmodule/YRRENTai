/**
 * «Цены → Автоцены» (pure): the nightly price follows how full a property is, the way dynamic-pricing
 * tools do it (PriceLabs occupancy adjustments) — not Booking deals. A rule looks at a window of nights,
 * counts the share that is booked, and moves the base price of the free nights down (little sold) or up
 * (much sold). The adjusted base then goes the usual way: channel markup, typed night price wins, minimum.
 * No database, no Booking here.
 */
import { channelPriceFromBase } from './base-price.util';
import { addDaysYmd, nightsCount } from './pricing-math.util';

/** «Ближайшие N дней» or «остаток месяца, начиная за N дней до его конца». */
export type AutoPriceWindow = { kind: 'next'; days: number } | { kind: 'month_end'; daysBefore: number };
/** «Не сдано от X % → −Y %». */
export type DownTier = { unsoldPct: number; pct: number };
/** «Сдано от X % → +Y %». */
export type UpTier = { soldPct: number; pct: number };

export type AutoPriceSettings = {
  window: AutoPriceWindow;
  down: DownTier[];
  up: UpTier[];
};

export const NEXT_DAYS_MIN = 3;
export const NEXT_DAYS_MAX = 30;
export const MONTH_END_DAYS_MIN = 3;
export const MONTH_END_DAYS_MAX = 14;
export const TIER_PCT_MAX = 50;
export const TIERS_MAX = 4;

/** The manager's example (2026-10-26): a week before the month ends, 70 % unsold → −10 %, 50 % → −5 %. */
export const DEFAULT_AUTO_PRICE_SETTINGS: AutoPriceSettings = {
  window: { kind: 'month_end', daysBefore: 7 },
  down: [
    { unsoldPct: 70, pct: 10 },
    { unsoldPct: 50, pct: 5 },
  ],
  up: [{ soldPct: 85, pct: 5 }],
};

/** Down tiers emptiest first, up tiers fullest first — the order they are matched in. */
export function sortDown(tiers: readonly DownTier[]): DownTier[] {
  return [...tiers].sort((a, b) => b.unsoldPct - a.unsoldPct);
}

export function sortUp(tiers: readonly UpTier[]): UpTier[] {
  return [...tiers].sort((a, b) => b.soldPct - a.soldPct);
}

const whole = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

/** null when the settings can be used as they are; otherwise what is wrong, in one line. */
export function settingsProblem(s: AutoPriceSettings): string | null {
  if (s.window.kind === 'next' && !whole(s.window.days, NEXT_DAYS_MIN, NEXT_DAYS_MAX)) {
    return `Окно — от ${NEXT_DAYS_MIN} до ${NEXT_DAYS_MAX} дней`;
  }
  if (s.window.kind === 'month_end' && !whole(s.window.daysBefore, MONTH_END_DAYS_MIN, MONTH_END_DAYS_MAX)) {
    return `Начало — за ${MONTH_END_DAYS_MIN}–${MONTH_END_DAYS_MAX} дней до конца месяца`;
  }
  if (s.window.kind !== 'next' && s.window.kind !== 'month_end') return 'Неизвестное окно';
  if (s.down.length + s.up.length === 0) return 'Нужен хотя бы один порог';
  if (s.down.length > TIERS_MAX || s.up.length > TIERS_MAX) return `Не больше ${TIERS_MAX} порогов в каждую сторону`;
  for (const t of s.down) {
    if (!whole(t.unsoldPct, 1, 100) || !whole(t.pct, 1, TIER_PCT_MAX)) {
      return `Порог — целое от 1 до 100 %, снижение — от 1 до ${TIER_PCT_MAX} %`;
    }
  }
  for (const t of s.up) {
    if (!whole(t.soldPct, 1, 100) || !whole(t.pct, 1, TIER_PCT_MAX)) {
      return `Порог — целое от 1 до 100 %, повышение — от 1 до ${TIER_PCT_MAX} %`;
    }
  }
  const down = sortDown(s.down);
  for (let i = 1; i < down.length; i++) {
    if (down[i]!.unsoldPct === down[i - 1]!.unsoldPct) return `Порог «не сдано от ${down[i]!.unsoldPct} %» указан дважды`;
    if (down[i]!.pct > down[i - 1]!.pct) return 'Чем больше не сдано, тем больше снижение';
  }
  const up = sortUp(s.up);
  for (let i = 1; i < up.length; i++) {
    if (up[i]!.soldPct === up[i - 1]!.soldPct) return `Порог «сдано от ${up[i]!.soldPct} %» указан дважды`;
    if (up[i]!.pct > up[i - 1]!.pct) return 'Чем больше сдано, тем больше повышение';
  }
  // One share must never match both sides: «not sold from X %» is «sold up to 100 − X %».
  if (down.length && up.length) {
    const lowestDown = down[down.length - 1]!.unsoldPct;
    const lowestUp = up[up.length - 1]!.soldPct;
    if (lowestUp <= 100 - lowestDown) {
      return `Пороги пересекаются: «не сдано от ${lowestDown} %» и «сдано от ${lowestUp} %» срабатывают вместе`;
    }
  }
  return null;
}

/** Last night of the month of `ymd`. */
export function monthEnd(ymd: string): string {
  const first = `${ymd.slice(0, 7)}-01`;
  const nextFirst = `${addDaysYmd(first, 32).slice(0, 7)}-01`;
  return addDaysYmd(nextFirst, -1);
}

/**
 * The nights the rule looks at today (inclusive), or null while it is silent: «остаток месяца» starts when
 * the nights left in the month (today included) are no more than `daysBefore`.
 */
export function autoPriceWindow(today: string, w: AutoPriceWindow): { from: string; to: string } | null {
  if (w.kind === 'next') return { from: today, to: addDaysYmd(today, w.days - 1) };
  const last = monthEnd(today);
  return nightsCount(today, last) <= w.daysBefore ? { from: today, to: last } : null;
}

/**
 * Signed percent for `booked` of `total` nights: the emptiest down tier the unsold share reaches, else the
 * fullest up tier the sold share reaches, else 0. Compared as fractions — 7 of 10 unsold is exactly 70 %.
 */
export function pickAdjustment(booked: number, total: number, s: Pick<AutoPriceSettings, 'down' | 'up'>): number {
  if (!(total > 0) || booked < 0 || booked > total) return 0;
  const unsold = total - booked;
  const down = sortDown(s.down).find((t) => unsold * 100 >= t.unsoldPct * total);
  if (down) return -down.pct;
  const up = sortUp(s.up).find((t) => booked * 100 >= t.soldPct * total);
  return up ? up.pct : 0;
}

/** Base moved by `pct`, in whole units of the currency (0 % leaves it as it is). */
export function adjustBase(base: number, pct: number): number {
  if (!pct) return base;
  return Math.round((base * (100 + pct)) / 100);
}

/**
 * A channel's price of a night with an automatic adjustment: adjusted base → channel markup → never below
 * the minimum (the adjusted night gets the minimum instead of being skipped).
 */
export function autoChannelPrice(
  base: number,
  pct: number,
  markupPct: number | null | undefined,
  minPrice: number | null | undefined,
): number {
  const price = channelPriceFromBase(adjustBase(base, pct), markupPct);
  return minPrice != null && minPrice > 0 && price < minPrice ? minPrice : price;
}

export type AutoNightInput = {
  date: string;
  /** Taken by a booking (RentAI bookings of every channel). */
  booked: boolean;
  /** The property's base price of the night; null = none set. */
  base: number | null;
  /** A price typed for this night and channel — it wins over any formula, the rule leaves it alone. */
  typed: boolean;
};

export type AutoNightStatus = 'adjusted' | 'minimum' | 'booked' | 'typed' | 'no_base' | 'none';

export type AutoNight = {
  date: string;
  status: AutoNightStatus;
  /** Signed percent the night carries (0 when the rule leaves it). */
  pct: number;
  /** Channel price without the rule; null without a base. */
  before: number | null;
  /** Channel price with the rule; null without a base. */
  after: number | null;
};

/** What the rule does to each night of the window. */
export function planAutoNights(
  nights: readonly AutoNightInput[],
  pct: number,
  markupPct: number | null | undefined,
  minPrice: number | null | undefined,
): AutoNight[] {
  return nights.map((n): AutoNight => {
    const before = n.base != null && n.base > 0 ? channelPriceFromBase(n.base, markupPct) : null;
    if (n.booked) return { date: n.date, status: 'booked', pct: 0, before, after: before };
    if (n.typed) return { date: n.date, status: 'typed', pct: 0, before, after: before };
    if (before == null) return { date: n.date, status: 'no_base', pct: 0, before: null, after: null };
    if (!pct) return { date: n.date, status: 'none', pct: 0, before, after: before };
    const raw = channelPriceFromBase(adjustBase(n.base!, pct), markupPct);
    const after = autoChannelPrice(n.base!, pct, markupPct, minPrice);
    // Already under the minimum: lowering would lift it to the minimum — a «discount» that raises the price.
    if (pct < 0 && after > before) return { date: n.date, status: 'none', pct: 0, before, after: before };
    return { date: n.date, status: after !== raw ? 'minimum' : 'adjusted', pct, before, after };
  });
}

/**
 * What changes in the stored adjustments: nights to set (new or another percent) and nights to clear
 * (the rule no longer wants them: sold, outside the window, rule switched off, between the tiers).
 * Nights before `today` are history — neither set nor cleared.
 */
export function diffAdjustments(
  current: ReadonlyMap<string, number>,
  wanted: ReadonlyMap<string, number>,
  today: string,
): { set: Map<string, number>; clear: string[] } {
  const set = new Map<string, number>();
  for (const [d, pct] of wanted) if (d >= today && current.get(d) !== pct) set.set(d, pct);
  const clear = [...current.keys()].filter((d) => d >= today && !wanted.has(d)).sort();
  return { set, clear };
}
