/**
 * «Цена для гостя» (no React): what a guest really pays on a channel for a stay, line by line —
 * the breakdown Booking shows in «Данные бронирования».
 *
 * `guestPriceBreakdown` and the helpers next to it are a copy of backend
 * `backend/src/pricing/guest-price.util.ts`: the server recalculates every calibration with its copy
 * and logs a drift, so keep the two in step (their specs share the Booking case of 2026-10-22).
 * Booking order: cheapest rate → Genius → hand-typed → the visible deal → Mobile / Country,
 * one after another; cleaning is not discounted; VAT sits inside the room price only.
 */

import type { ChannelProfile } from '../api';
import { liveDeal, weekdayOf, type CellPromotion } from './pricing-ui';

export type GuestDiscountKind = 'rate_plan' | 'genius' | 'extra' | 'deal' | 'targeting' | 'length_of_stay';

export type GuestDiscount = { kind: GuestDiscountKind; label: string; pct: number };

export type StayNightInput = { date: string; rack: number; discounts: readonly GuestDiscount[] };

export type StayFeeKind = 'cleaning' | 'pets' | 'other';

export type StayFee = { kind: StayFeeKind; label: string; amount: number };

export type GuestPriceInput = {
  nights: readonly StayNightInput[];
  fees?: readonly StayFee[];
  taxesOnTop?: readonly { label: string; amount: number }[];
  vatIncludedPct?: number | null;
};

export type GuestPriceLineKind = 'rack' | GuestDiscountKind | StayFeeKind | 'tax';

export type GuestPriceLine = { kind: GuestPriceLineKind; label: string; amount: number };

export type GuestPriceBreakdown = {
  lines: GuestPriceLine[];
  original: number;
  room: number;
  fees: number;
  taxesOnTop: number;
  total: number;
  vatIncluded: number | null;
  roomPerNight: { date: string; amount: number }[];
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clampPct(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

export function guestPriceBreakdown(input: GuestPriceInput): GuestPriceBreakdown {
  let rackTotal = 0;
  const discountTotals = new Map<string, GuestPriceLine>();
  const roomPerNight: { date: string; amount: number }[] = [];

  for (const night of input.nights) {
    const rack = Math.max(0, night.rack);
    rackTotal += rack;
    let price = rack;
    for (const d of night.discounts) {
      const pct = clampPct(d.pct);
      if (pct === 0) continue;
      const cut = (price * pct) / 100;
      price -= cut;
      const key = `${d.kind}|${d.label}`;
      const line = discountTotals.get(key) ?? { kind: d.kind, label: d.label, amount: 0 };
      line.amount -= cut;
      discountTotals.set(key, line);
    }
    roomPerNight.push({ date: night.date, amount: round2(price) });
  }

  const rackLine: GuestPriceLine = { kind: 'rack', label: 'Тариф', amount: round2(rackTotal) };
  const discountLines = [...discountTotals.values()]
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .filter((l) => l.amount !== 0);
  const feeLines: GuestPriceLine[] = (input.fees ?? [])
    .filter((f) => f.amount > 0)
    .map((f) => ({ kind: f.kind, label: f.label, amount: round2(f.amount) }));
  const taxLines: GuestPriceLine[] = (input.taxesOnTop ?? [])
    .filter((t) => t.amount > 0)
    .map((t) => ({ kind: 'tax' as const, label: t.label, amount: round2(t.amount) }));

  const ratePlanCut = discountLines.filter((l) => l.kind === 'rate_plan').reduce((s, l) => s + l.amount, 0);
  const room = round2(rackLine.amount + discountLines.reduce((s, l) => s + l.amount, 0));
  const fees = round2(feeLines.reduce((s, l) => s + l.amount, 0));
  const taxesOnTop = round2(taxLines.reduce((s, l) => s + l.amount, 0));
  const vatPct = input.vatIncludedPct;
  const vatIncluded = vatPct != null && vatPct > 0 ? round2((room * vatPct) / (100 + vatPct)) : null;

  return {
    lines: [rackLine, ...discountLines, ...feeLines, ...taxLines],
    original: round2(rackLine.amount + ratePlanCut + fees),
    room,
    fees,
    taxesOnTop,
    total: round2(room + fees + taxesOnTop),
    vatIncluded,
    roomPerNight,
  };
}

export function airbnbLengthOfStayDiscount(
  nights: number,
  p: { weeklyPct?: number | null; monthlyPct?: number | null },
): GuestDiscount | null {
  if (nights >= 28 && p.monthlyPct) return { kind: 'length_of_stay', label: 'Скидка за месяц', pct: p.monthlyPct };
  if (nights >= 7 && p.weeklyPct) return { kind: 'length_of_stay', label: 'Скидка за неделю', pct: p.weeklyPct };
  return null;
}

export function nightsBelowMinPrice(
  breakdown: Pick<GuestPriceBreakdown, 'roomPerNight'>,
  minPrice: number | null | undefined,
): string[] {
  if (!minPrice || minPrice <= 0) return [];
  return breakdown.roomPerNight.filter((n) => n.amount < minPrice).map((n) => n.date);
}

export function compareWithObserved(
  calculatedTotal: number,
  observedTotal: number,
  tolerancePct = 1,
): { deltaPct: number; withinTolerance: boolean } {
  if (!(observedTotal > 0)) return { deltaPct: 0, withinTolerance: false };
  const deltaPct = round2(((calculatedTotal - observedTotal) / observedTotal) * 100);
  return { deltaPct, withinTolerance: Math.abs(deltaPct) <= tolerancePct };
}

// ─── What the panel prices (browser only) ────────────────────────────────────

/** `min` — the lowest price any guest can get; `regular` — a guest without Genius, from a computer. */
export type GuestPriceScenario = 'min' | 'regular';

/** A night as the calendar knows it. */
export type BookingNightSource = {
  ymd: string;
  /** Standard rate on Booking. */
  rack: number | null;
  /** Cheapest open rate (often non-refundable). */
  rackFrom: number | null;
  rateName: string | null;
  /** Free and open on Booking; a booked or closed night has no price a guest could pay. */
  onSale: boolean;
  promotions: readonly CellPromotion[];
  targetingPct: number | null;
};

/** The server accepts line labels up to this length (Booking and RentAI discount names). */
const LABEL_MAX = 120;

export type StayQuoteInput = {
  input: GuestPriceInput;
  /** Nights left out: no price known for them (or not on sale) — the total is not for the whole stay. */
  missing: string[];
};

function feesAndTaxes(
  profile: ChannelProfile | null,
  nights: number,
  guests: number,
  labels: { cleaning: string; cityTax: string },
): Pick<GuestPriceInput, 'fees' | 'taxesOnTop' | 'vatIncludedPct'> {
  const fees: StayFee[] = profile?.cleaningFee ? [{ kind: 'cleaning', label: labels.cleaning, amount: profile.cleaningFee }] : [];
  const tax = profile?.cityTaxPerGuestNight ? profile.cityTaxPerGuestNight * guests * nights : 0;
  return {
    fees,
    taxesOnTop: tax > 0 ? [{ label: labels.cityTax, amount: tax }] : [],
    vatIncludedPct: profile?.vatIncludedPct ?? null,
  };
}

/** Booking, for the picked nights: the cheapest rate and every stacking discount (`min`), or a regular guest. */
export function bookingStayInput(p: {
  nights: readonly BookingNightSource[];
  scenario: GuestPriceScenario;
  geniusPct: number | null;
  profile: ChannelProfile | null;
  guests: number;
  labels: { cleaning: string; cityTax: string; mobile: string };
  /** Price for this many guests vs the standard two (`occupancyFactor`); 1 = as Booking has it. */
  occupancy?: number;
}): StayQuoteInput {
  const factor = p.occupancy ?? 1;
  const nights: StayNightInput[] = [];
  const missing: string[] = [];
  for (const n of p.nights) {
    const rate = p.scenario === 'min' ? (n.rackFrom ?? n.rack) : n.rack;
    const rack = rate != null ? round2(rate * factor) : null;
    if (!n.onSale || rack == null || !(rack > 0)) {
      missing.push(n.ymd);
      continue;
    }
    const deal = liveDeal(n.promotions);
    const discounts: GuestDiscount[] = [];
    if (p.scenario === 'min' && p.geniusPct) discounts.push({ kind: 'genius', label: 'Genius', pct: p.geniusPct });
    if (p.scenario === 'min') {
      for (const x of p.profile?.extraDiscounts ?? []) if (x.pct) discounts.push({ kind: 'extra', label: x.label.slice(0, LABEL_MAX), pct: x.pct });
    }
    if (deal) discounts.push({ kind: 'deal', label: deal.name.slice(0, LABEL_MAX), pct: deal.discountPct });
    if (p.scenario === 'min' && n.targetingPct) discounts.push({ kind: 'targeting', label: p.labels.mobile, pct: n.targetingPct });
    nights.push({ date: n.ymd, rack, discounts });
  }
  return { input: { nights, ...feesAndTaxes(p.profile, nights.length, p.guests, p.labels) }, missing };
}

/**
 * Airbnb's price of a night: typed for the date; else the base price with the Airbnb markup (when the
 * night has a base price); else the profile's weekend (Fri, Sat) or weekday price.
 */
export function airbnbNightPrice(
  ymd: string,
  profile: ChannelProfile | null,
  nightPrices: Readonly<Record<string, number>>,
  fromBase?: { base: Readonly<Record<string, number>>; markupPct: number } | null,
): number | null {
  const typed = nightPrices[ymd];
  if (typed != null && typed > 0) return typed;
  const b = fromBase?.base[ymd];
  if (b != null && b > 0) return channelPriceFromBase(b, fromBase!.markupPct);
  const wd = weekdayOf(ymd);
  const weekend = wd === 'Fri' || wd === 'Sat' ? profile?.weekendNightly : null;
  return weekend ?? profile?.nightly ?? null;
}

/** Airbnb, for the picked nights: nightly price, length-of-stay discount (by all picked nights), fees. */
export function airbnbStayInput(p: {
  dates: readonly string[];
  profile: ChannelProfile | null;
  nightPrices: Readonly<Record<string, number>>;
  guests: number;
  labels: { cleaning: string; cityTax: string; weekly: string; monthly: string };
  fromBase?: { base: Readonly<Record<string, number>>; markupPct: number } | null;
  /** Price for this many guests vs the standard two (`occupancyFactor`). */
  occupancy?: number;
}): StayQuoteInput {
  const factor = p.occupancy ?? 1;
  const los = airbnbLengthOfStayDiscount(p.dates.length, p.profile ?? {});
  const losLabelled = los ? { ...los, label: los.label === 'Скидка за месяц' ? p.labels.monthly : p.labels.weekly } : null;
  const nights: StayNightInput[] = [];
  const missing: string[] = [];
  for (const ymd of p.dates) {
    const price = airbnbNightPrice(ymd, p.profile, p.nightPrices, p.fromBase);
    const rack = price != null ? round2(price * factor) : null;
    if (rack == null) {
      missing.push(ymd);
      continue;
    }
    nights.push({ date: ymd, rack, discounts: losLabelled ? [losLabelled] : [] });
  }
  return { input: { nights, ...feesAndTaxes(p.profile, nights.length, p.guests, p.labels) }, missing };
}

/**
 * Nights a guest cannot buy on Booking: booked, blocked or closed there. A night with no price at all
 * (`unknown` — Booking did not answer or sent nothing) is not one of them: it is only «no price».
 */
export function countBookedOrClosed(nights: readonly { kind: string }[]): number {
  return nights.filter((n) => n.kind === 'booked' || n.kind === 'blocked' || n.kind === 'closed').length;
}

// ─── «Базовая цена» — same as backend base-price.util.ts ──────────────────────

/** base × (100 + markupPct) / 100, rounded to whole units; without a markup the base as it is (89,90 stays). */
export function channelPriceFromBase(base: number, markupPct: number | null | undefined): number {
  const pct = Number.isFinite(markupPct) ? (markupPct as number) : 0;
  if (pct === 0) return Math.round(base * 100) / 100;
  return Math.round((base * (100 + pct)) / 100);
}

/** What RentAI sets on a channel for a night: typed for it, else base × markup; null = neither. */
export function channelNightPrice(
  ymd: string,
  base: Readonly<Record<string, number>>,
  typed: Readonly<Record<string, number>>,
  markupPct: number | null | undefined,
): number | null {
  const t = typed[ymd];
  if (t != null && t > 0) return t;
  const b = base[ymd];
  return b != null && b > 0 ? channelPriceFromBase(b, markupPct) : null;
}

/**
 * Price for `guests` against the standard two: one guest pays `singleGuestPct` less, each guest above
 * two adds `extraGuestPct`. Without a rule (or for two guests) — 1.
 */
export function occupancyFactor(
  guests: number,
  rule: { singleGuestPct: number | null; extraGuestPct: number | null } | null | undefined,
): number {
  if (!rule) return 1;
  if (guests <= 1) return rule.singleGuestPct ? (100 - rule.singleGuestPct) / 100 : 1;
  if (guests > 2) return rule.extraGuestPct ? 1 + (rule.extraGuestPct * (guests - 2)) / 100 : 1;
  return 1;
}

export type BookingCell = {
  /** Price RentAI sets on Booking for the night. */
  price: number;
  /** Typed for this night (an exception), not from the base price. */
  typed: boolean;
  /** Booking has another price now on a night open for sale — the new one is not sent yet. */
  pending: boolean;
  /** Lowest room price a guest can see for the night at that price (no cleaning). */
  minGuest: number;
};

/**
 * One calendar cell, Booking row: the price RentAI sets and what the cheapest guest pays for it. A cheaper
 * open rate Booking has (non-refundable) keeps its ratio to Standard.
 */
export function bookingCell(
  n: BookingNightSource,
  p: {
    base: Readonly<Record<string, number>>;
    typed: Readonly<Record<string, number>>;
    markupPct: number;
    geniusPct: number | null;
    profile: ChannelProfile | null;
  },
): BookingCell | null {
  const price = channelNightPrice(n.ymd, p.base, p.typed, p.markupPct);
  if (price == null) return null;
  const from = n.rack && n.rackFrom && n.rackFrom < n.rack ? round2((price * n.rackFrom) / n.rack) : null;
  const q = bookingStayInput({
    nights: [{ ...n, rack: price, rackFrom: from, onSale: true }],
    scenario: 'min',
    geniusPct: p.geniusPct,
    profile: p.profile,
    guests: 2,
    labels: { cleaning: '', cityTax: '', mobile: '' },
  });
  const minGuest = guestPriceBreakdown(q.input).roomPerNight[0]?.amount ?? price;
  const t = p.typed[n.ymd];
  return {
    price,
    typed: t != null && t > 0,
    // A closed / booked night is never re-priced by a run: no «not sent» mark for it.
    pending: n.onSale && n.rack != null && Math.abs(n.rack - price) >= 0.005,
    minGuest,
  };
}

/** How much more (+) or less (−) `other` costs than `base`, in %; null when `base` is not a price. */
export function gapPct(base: number, other: number): number | null {
  if (!(base > 0)) return null;
  return round2(((other - base) / base) * 100);
}
