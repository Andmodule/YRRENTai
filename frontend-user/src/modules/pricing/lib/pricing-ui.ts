/**
 * Pure helpers for «Цены» (no React). Same rules as backend `pricing-math.util.ts`:
 * Booking applies Genius first, then the deal; deals of one category never add up;
 * a Mobile / Country rate from the extranet (`targetingPct`) stacks on top of both.
 */

import type { BookingWeekday, CalendarPromotion, PromotionSummary, PromotionTargetState } from '../api';

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

export function guestPrice(
  price: number,
  discountPct: number,
  geniusPct?: number | null,
  targetingPct?: number | null,
): number {
  const afterDeal = (((price * (100 - Math.max(0, geniusPct ?? 0))) / 100) * (100 - discountPct)) / 100;
  return (afterDeal * (100 - Math.max(0, targetingPct ?? 0))) / 100;
}

/** Largest whole discount keeping the lowest guest price ≥ minPrice (null = no minimum, ≤ 0 = impossible). */
export function safeDiscountPct(
  price: number,
  geniusPct: number | null,
  minPrice: number | null,
  targetingPct?: number | null,
): number | null {
  if (!minPrice || minPrice <= 0 || !(price > 0)) return null;
  const base = guestPrice(price, 0, geniusPct, targetingPct);
  return Math.floor((1 - minPrice / base) * 100 + 1e-9);
}

export function isBelowMin(
  price: number,
  discountPct: number,
  geniusPct: number | null,
  minPrice: number | null,
  targetingPct?: number | null,
): boolean {
  return !!minPrice && minPrice > 0 && guestPrice(price, discountPct, geniusPct, targetingPct) < minPrice;
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
  /** Booking lists it (an extranet deal always; ours once it was found there). */
  confirmed: boolean;
  /** Why it did not reach Booking — only for `skipped` / `error`. */
  errorCode: string | null;
};

/** Saved in RentAI but not on Booking: skipped (pilot list, minimum price…) or failed. */
export function isNotSent(state: PromotionTargetState): boolean {
  return state === 'skipped' || state === 'error';
}

/**
 * Discounts that apply to one property on one night. The first one is what the guest sees —
 * unless it `isNotSent`: those go last and never hide a discount that is really on Booking.
 */
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
      confirmed: target.confirmed,
      errorCode: target.errorCode,
    });
  }
  // Booking shows only the highest discount; live ones win over pending / dry-run at equal size.
  const rank = (s: PromotionTargetState) => (s === 'on' ? 0 : s === 'pending' ? 1 : 2);
  return out.sort(
    (a, b) =>
      Number(isNotSent(a.state)) - Number(isNotSent(b.state)) ||
      b.discountPct - a.discountPct ||
      rank(a.state) - rank(b.state),
  );
}

export type CampaignHealth = 'ok' | 'not_sent' | 'unconfirmed';

/**
 * An «active» discount of ours is only really active if it is on Booking somewhere:
 * `not_sent` — no property has it (all skipped / failed); `unconfirmed` — sent, but Booking lists none yet.
 */
export function campaignHealth(p: Pick<PromotionSummary, 'derivedStatus' | 'source' | 'counts'>): CampaignHealth {
  if (p.derivedStatus !== 'active' || p.source !== 'rentai') return 'ok';
  const c = p.counts;
  if (c.on + c.pending + c.dry_run === 0) return c.skipped + c.error > 0 ? 'not_sent' : 'ok';
  if (c.pending === 0 && c.dry_run === 0 && c.unconfirmed === c.on) return 'unconfirmed';
  return 'ok';
}

export function sumRevenue(byCurrency: Record<string, number> | null | undefined): { amount: number; currency: string }[] {
  return Object.entries(byCurrency ?? {})
    .filter(([, v]) => v > 0)
    .map(([currency, amount]) => ({ currency, amount }));
}

export function isTargetDone(state: PromotionTargetState): boolean {
  return state !== 'pending';
}
