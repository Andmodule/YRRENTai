/**
 * Pure helpers for «Цены» (no React). Same rules as backend `pricing-math.util.ts`:
 * Booking applies Genius first, then the deal; deals of one category never add up.
 */

import type {
  BookingWeekday,
  BookTime,
  CalendarPromotion,
  PromotionTargetState,
  RuleStepInput,
} from '../api';

export const WEEKDAYS: BookingWeekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DISCOUNT_PRESETS = [5, 10, 15, 20] as const;

function utcNoon(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

/** Local calendar day as yyyy-MM-dd. */
export function localYmd(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(utcNoon(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

export function nightsCount(from: string, to: string): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / 86_400_000) + 1;
}

export function weekdayOf(ymd: string): BookingWeekday {
  const idx = new Date(utcNoon(ymd)).getUTCDay();
  return WEEKDAYS[(idx + 6) % 7]!;
}

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

export type DatePreset = 'today' | 'weekend' | 'week' | 'custom';

/** Inclusive stay range for a quick choice, counted from `today`. */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, today: string): { from: string; to: string } {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: today, to: addDaysYmd(today, 6) };
  const wd = weekdayOf(today);
  if (wd === 'Sun') return { from: today, to: today };
  if (wd === 'Sat') return { from: today, to: addDaysYmd(today, 1) };
  const offset = WEEKDAYS.indexOf('Sat') - WEEKDAYS.indexOf(wd);
  const sat = addDaysYmd(today, offset);
  return { from: sat, to: addDaysYmd(sat, 1) };
}

/** null = every day. */
export function normalizeWeekdays(days: readonly BookingWeekday[]): BookingWeekday[] | null {
  const set = new Set(days);
  const out = WEEKDAYS.filter((d) => set.has(d));
  return out.length === 0 || out.length === WEEKDAYS.length ? null : out;
}

export function guestPrice(price: number, discountPct: number, geniusPct?: number | null): number {
  return ((price * (100 - Math.max(0, geniusPct ?? 0))) / 100) * (100 - discountPct) / 100;
}

/** Largest whole discount keeping the Genius price ≥ minPrice (null = no minimum, ≤ 0 = impossible). */
export function safeDiscountPct(price: number, geniusPct: number | null, minPrice: number | null): number | null {
  if (!minPrice || minPrice <= 0 || !(price > 0)) return null;
  const g = (price * (100 - Math.max(0, geniusPct ?? 0))) / 100;
  return Math.floor((1 - minPrice / g) * 100 + 1e-9);
}

export function isBelowMin(price: number, discountPct: number, geniusPct: number | null, minPrice: number | null): boolean {
  return !!minPrice && minPrice > 0 && guestPrice(price, discountPct, geniusPct) < minPrice;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CellPromotion = {
  id: string;
  name: string;
  discountPct: number;
  source: CalendarPromotion['source'];
  promotionType: string;
  state: PromotionTargetState;
};

/** Discounts that apply to one property on one night; the first one is what the guest sees. */
export function promotionsForCell(
  promotions: readonly CalendarPromotion[],
  propertyId: string,
  ymd: string,
): CellPromotion[] {
  const wd = weekdayOf(ymd);
  const out: CellPromotion[] = [];
  for (const p of promotions) {
    if (ymd < p.from || ymd > p.to) continue;
    if (p.activeWeekdays && p.activeWeekdays.length > 0 && !p.activeWeekdays.includes(wd)) continue;
    const target = p.properties.find((x) => x.propertyId === propertyId);
    if (!target) continue;
    out.push({
      id: p.id,
      name: p.name,
      discountPct: p.discountPct,
      source: p.source,
      promotionType: p.promotionType,
      state: target.state,
    });
  }
  // Booking shows only the highest discount; live ones win over pending / dry-run at equal size.
  const rank = (s: PromotionTargetState) => (s === 'on' ? 0 : s === 'pending' ? 1 : 2);
  return out.sort((a, b) => b.discountPct - a.discountPct || rank(a.state) - rank(b.state));
}

export function sumRevenue(byCurrency: Record<string, number> | null | undefined): { amount: number; currency: string }[] {
  return Object.entries(byCurrency ?? {})
    .filter(([, v]) => v > 0)
    .map(([currency, amount]) => ({ currency, amount }));
}

export function isTargetDone(state: PromotionTargetState): boolean {
  return state !== 'pending';
}

// ─── «Автоправила»: a ladder of last-minute steps ────────────────────────────

/** Booking keeps the highest of such deals only, so a good ladder grows towards arrival. */
export const RULE_STEP_PRESETS = [5, 8, 10, 12, 15] as const;

export type TimeWindowKey = 'any' | 'morning' | 'day' | 'evening' | 'custom';

export const TIME_WINDOWS: Record<Exclude<TimeWindowKey, 'any' | 'custom'>, BookTime> = {
  morning: { start: 6, end: 12 },
  day: { start: 12, end: 18 },
  evening: { start: 18, end: 24 },
};

/** Which quick choice a booking-time window corresponds to. */
export function timeWindowKey(bookTime: BookTime | null): TimeWindowKey {
  if (!bookTime) return 'any';
  for (const [key, w] of Object.entries(TIME_WINDOWS)) {
    if (w.start === bookTime.start && w.end === bookTime.end) return key as TimeWindowKey;
  }
  return 'custom';
}

/** How long before check-in the step starts to apply. */
export function hoursBefore(step: Pick<RuleStepInput, 'unit' | 'value'>): number {
  return step.unit === 'day' ? step.value * 24 : step.value;
}

/** Farthest from arrival first, then by time of day — the order a person reads the ladder in. */
export function sortSteps<T extends RuleStepInput>(steps: readonly T[]): T[] {
  return [...steps].sort(
    (a, b) =>
      hoursBefore(b) - hoursBefore(a) ||
      (a.bookTime?.start ?? -1) - (b.bookTime?.start ?? -1) ||
      a.discountPct - b.discountPct,
  );
}

function windowCovers(outer: BookTime | null, inner: BookTime | null): boolean {
  if (!outer) return true;
  if (!inner) return false;
  return outer.start <= inner.start && outer.end >= inner.end;
}

/**
 * Steps a guest can never see: another step covers the same moments (it starts at least as early and
 * covers the same hours of the day) and gives the same or a bigger discount. Booking shows the highest.
 * Returns [shadowedIndex, coveringIndex] pairs.
 */
export function findShadowedSteps(steps: readonly RuleStepInput[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  steps.forEach((a, i) => {
    const j = steps.findIndex(
      (b, k) =>
        k !== i &&
        hoursBefore(b) >= hoursBefore(a) &&
        windowCovers(b.bookTime, a.bookTime) &&
        b.discountPct >= a.discountPct &&
        // identical moments and discount: only the later one is the duplicate
        !(hoursBefore(b) === hoursBefore(a) && timeWindowKey(b.bookTime) === timeWindowKey(a.bookTime) && b.discountPct === a.discountPct && k > i),
    );
    if (j >= 0) out.push([i, j]);
  });
  return out;
}

/** The ladder the manager asked for: 3 days → 1 day → arrival day morning / day / evening. */
export function ruleTemplate(): RuleStepInput[] {
  return [
    { discountPct: 5, unit: 'day', value: 3, bookTime: null },
    { discountPct: 8, unit: 'day', value: 1, bookTime: null },
    { discountPct: 10, unit: 'hour', value: 12, bookTime: TIME_WINDOWS.morning },
    { discountPct: 12, unit: 'hour', value: 12, bookTime: TIME_WINDOWS.day },
    { discountPct: 15, unit: 'hour', value: 12, bookTime: TIME_WINDOWS.evening },
  ];
}

/** Is `now` inside the booking-time window, hours counted in the property time zone? */
export function isBookTimeNow(bookTime: BookTime | null | undefined, timezone: string | null | undefined, now: Date = new Date()): boolean {
  if (!bookTime) return true;
  let hour: number;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone || 'UTC' }).format(now);
    hour = Number(parts);
  } catch {
    hour = now.getUTCHours();
  }
  return hour >= bookTime.start && hour < bookTime.end;
}

/** Booking-time window stored in a rule step's metadata, null for any time of day. */
export function bookTimeOf(meta: Record<string, unknown> | null | undefined): BookTime | null {
  const b = meta?.bookTime as { start?: unknown; end?: unknown } | null | undefined;
  return b && Number.isInteger(b.start) && Number.isInteger(b.end)
    ? { start: b.start as number, end: b.end as number }
    : null;
}

/** Steps of an auto rule are managed on their own tab, not in the list of ordinary discounts. */
export function isRuleStep(p: { externalMeta?: Record<string, unknown> | null }): boolean {
  const rule = p.externalMeta?.rule;
  return !!rule && typeof rule === 'object';
}
