/**
 * Calendar of one property by months (no React): the month grid, what each night is and what it costs.
 * Prices follow «Цены» (`pricing-ui.ts`): Booking's Standard rate, then one deal, Genius, Mobile / Country.
 */

import type { CalendarPromotion } from '@/modules/pricing/api';
import {
  addDaysYmd,
  type CellPromotion,
  nightPrices,
  type NightPrices,
  nightTargetingPct,
  promotionsForCell,
  stayNights,
} from '@/modules/pricing/lib/pricing-ui';
import type { Property, Reservation } from '../types';

/** yyyy-MM of a day. */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** First and last day of a month (yyyy-MM). */
export function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** yyyy-MM from the address bar; null when it is not a real month. */
export function parseMonth(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  return year >= 2000 && year <= 2100 ? v : null;
}

/** Weeks of the month, Monday first; days of other months are null. */
export function monthWeeks(ym: string): (string | null)[][] {
  const { from, to } = monthBounds(ym);
  const [y, m] = ym.split('-').map(Number);
  const lead = (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Inclusive range of nights picked in the grid. */
export type NightSelection = { from: string; to: string };

/**
 * Airbnb-like picking: a click picks one night; a click on another night while one is picked makes a range;
 * the next click starts over. A click on the only picked night clears the selection.
 */
export function nextSelection(sel: NightSelection | null, ymd: string): NightSelection | null {
  if (!sel || sel.from !== sel.to) return { from: ymd, to: ymd };
  if (sel.from === ymd) return null;
  return ymd < sel.from ? { from: ymd, to: sel.from } : { from: sel.from, to: ymd };
}

export function inSelection(sel: NightSelection | null, ymd: string): boolean {
  return !!sel && ymd >= sel.from && ymd <= sel.to;
}

/** Two dates in calendar order — a drag can go backwards. */
export function orderedRange(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «С» / «По» typed in the panel → the picked nights, kept inside the month on screen ([min, max]).
 * An empty or broken field leaves the other end as it was; «По» before «С» swaps them; null when nothing
 * of it falls inside the month.
 */
export function rangeFromFields(
  current: NightSelection,
  field: 'from' | 'to',
  value: string,
  min: string,
  max: string,
): NightSelection | null {
  const next = { ...current };
  if (YMD.test(value)) next[field] = value;
  const [from, to] = orderedRange(next.from, next.to);
  if (to < min || from > max) return null;
  return { from: from < min ? min : from, to: to > max ? max : to };
}

/**
 * What a night is:
 * - `booked` — a booking in RentAI (any channel); `blocked` — a block made in RentAI;
 * - `closed` — not for sale on Booking: closed there, sold there, or no room (RentAI has no booking);
 * - `open` — for sale on Booking at `rack`; `unknown` — Booking sent nothing for the night.
 */
export type MonthNightKind = 'booked' | 'blocked' | 'closed' | 'open' | 'unknown';

export type MonthNight = {
  ymd: string;
  past: boolean;
  today: boolean;
  kind: MonthNightKind;
  /** The booking or block on this night. */
  reservation: Reservation | null;
  /** First night of that booking (its name is printed there). */
  arrival: boolean;
  /** Price of the Standard rate on Booking (before discounts and Genius), null = none. */
  rack: number | null;
  /** Rate the price came from, null = not known. */
  rateName: string | null;
  /** Cheapest rate open for sale on Booking (often non-refundable), null = none. */
  rackFrom: number | null;
  promotions: CellPromotion[];
  /** Mobile / Country rate on this night, %. */
  targetingPct: number | null;
  /** What guests pay — only for nights on sale. */
  prices: NightPrices | null;
  minStay: number | null;
  closedOnArrival: boolean;
  closedOnDeparture: boolean;
};

export function buildMonthNights(input: {
  from: string;
  to: string;
  today: string;
  property: Pick<
    Property,
    'uuid' | 'otaBlockedDays' | 'otaNightlyPrices' | 'otaNightlyPricesFromOpen' | 'otaNightlyPriceMeta' | 'otaRestrictions'
  >;
  reservations: readonly Reservation[];
  promotions: readonly CalendarPromotion[];
  geniusPct: number | null;
  /** Property-wide Mobile / Country rate, % (used when the night's list has none). */
  targetingPct: number | null;
}): MonthNight[] {
  const { property } = input;
  const byNight = new Map<string, { r: Reservation; arrival: boolean }>();
  for (const r of input.reservations) {
    // Channel-closed bars are made from otaBlockedDays — those nights are `closed`, not a booking.
    if (r.propertyId !== property.uuid || r.status === 'cancelled' || r.otaInventoryBlock) continue;
    stayNights(r.checkIn, r.checkOut).forEach((night, i) => {
      if (!byNight.has(night)) byNight.set(night, { r, arrival: i === 0 });
    });
  }
  const closed = new Set((property.otaBlockedDays ?? []).map((d) => d.slice(0, 10)));
  const hints = new Map<string, { minStay: number | null; coa: boolean; cod: boolean }>();
  for (const h of property.otaRestrictions ?? []) {
    const d = h.date.slice(0, 10);
    const cur = hints.get(d) ?? { minStay: null, coa: false, cod: false };
    if (h.kind === 'minStay' && h.minStay && h.minStay > 1) cur.minStay = h.minStay;
    if (h.kind === 'closedOnArrival') cur.coa = true;
    if (h.kind === 'closedOnDeparture') cur.cod = true;
    if (h.kind === 'closed') closed.add(d);
    hints.set(d, cur);
  }

  const out: MonthNight[] = [];
  for (let ymd = input.from; ymd <= input.to && out.length < 62; ymd = addDaysYmd(ymd, 1)) {
    const res = byNight.get(ymd) ?? null;
    const rawRack = property.otaNightlyPrices?.[ymd];
    const rack = rawRack != null && Number.isFinite(rawRack) && rawRack > 0 ? rawRack : null;
    const rawFrom = property.otaNightlyPricesFromOpen?.[ymd];
    const rackFrom = rawFrom != null && Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : null;
    const kind: MonthNightKind = res
      ? res.r.status === 'blocked'
        ? 'blocked'
        : 'booked'
      : closed.has(ymd)
        ? 'closed'
        : rack != null
          ? 'open'
          : 'unknown';
    const promotions = kind === 'open' ? promotionsForCell(input.promotions, property.uuid, ymd) : [];
    const targetingPct = kind === 'open' ? nightTargetingPct(promotions, input.targetingPct) : null;
    const hint = hints.get(ymd);
    out.push({
      ymd,
      past: ymd < input.today,
      today: ymd === input.today,
      kind,
      reservation: res?.r ?? null,
      arrival: res?.arrival ?? false,
      rack,
      rateName: property.otaNightlyPriceMeta?.[ymd]?.rateName ?? null,
      rackFrom,
      promotions,
      targetingPct,
      prices: kind === 'open' && rack != null ? nightPrices(rack, promotions, input.geniusPct, targetingPct) : null,
      minStay: hint?.minStay ?? null,
      closedOnArrival: hint?.coa ?? false,
      closedOnDeparture: hint?.cod ?? false,
    });
  }
  return out;
}

export type MonthSummary = {
  open: number;
  booked: number;
  closed: number;
  /** Average price a regular guest pays for the free nights still ahead, null = none. */
  avgOpenPrice: number | null;
};

/** Counts over the nights from today on (past nights are history). */
export function summarizeNights(nights: readonly MonthNight[]): MonthSummary {
  let open = 0;
  let booked = 0;
  let closed = 0;
  let sum = 0;
  for (const n of nights) {
    if (n.past) continue;
    if (n.kind === 'booked' || n.kind === 'blocked') booked++;
    else if (n.kind === 'closed') closed++;
    else if (n.kind === 'open' && n.prices) {
      open++;
      sum += n.prices.regular;
    }
  }
  return { open, booked, closed, avgOpenPrice: open > 0 ? Math.round(sum / open) : null };
}

/** A picked night with its own Booking price: that price goes to Booking, the base price of the night does not. */
export interface TypedBookingNight {
  ymd: string;
  price: number;
  base: number | null;
}

/** The picked nights whose Booking price is typed by hand, in date order (a base price saved there changes nothing on Booking). */
export function typedBookingNights(
  picked: readonly { ymd: string }[],
  typed: Readonly<Record<string, number>>,
  base: Readonly<Record<string, number>>,
): TypedBookingNight[] {
  return picked
    .filter((n) => typed[n.ymd] != null && typed[n.ymd]! > 0)
    .map((n) => ({ ymd: n.ymd, price: typed[n.ymd]!, base: base[n.ymd] ?? null }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd));
}

/** Bookings that touch the picked nights, in order of arrival. */
export function reservationsInSelection(nights: readonly MonthNight[], sel: NightSelection | null): Reservation[] {
  if (!sel) return [];
  const seen = new Map<string, Reservation>();
  for (const n of nights) {
    if (n.reservation && inSelection(sel, n.ymd) && !seen.has(n.reservation.uuid)) seen.set(n.reservation.uuid, n.reservation);
  }
  return [...seen.values()];
}
