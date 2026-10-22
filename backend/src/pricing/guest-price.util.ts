/**
 * «Цена для гостя»: what a guest really pays on a channel for a stay, line by line —
 * the same breakdown Booking shows a guest in «Данные бронирования».
 *
 * Pure: no channel calls. The inputs are what RentAI knows (the price sent to the channel,
 * the discounts in force, fees, VAT). `compareWithObserved` checks the result against a total
 * taken from the channel itself: a gap means a discount or a fee RentAI does not know about.
 *
 * The calendar panel runs the same calculation in the browser
 * (frontend-user/src/modules/pricing/lib/guest-price.ts); the server recalculates every calibration
 * with this copy and logs a drift. Keep the two in step — their specs share the Booking case below.
 *
 * Booking order (see pricing-math.util.ts, Partner Hub checked 2026-10-04 / 2026-10-08):
 * derived rate plan → Genius → the visible deal → Mobile / Country rate, one after another;
 * cleaning is not discounted; VAT is already inside the room price (Booking lists the cleaning
 * fee apart and counts VAT on the room only).
 * Matches a guest breakdown of 2026-10-22 to the grosz:
 * 284 → 241,40 → −45,87 → −19,55 → −17,60, + cleaning 59,00 = 217,38 (VAT 8 % 11,73).
 */

/** `extra` — a discount RentAI cannot read from the channel, typed in by hand after a calibration. */
export type GuestDiscountKind = 'rate_plan' | 'genius' | 'extra' | 'deal' | 'targeting' | 'length_of_stay';

export type GuestDiscount = { kind: GuestDiscountKind; label: string; pct: number };

export type StayNightInput = {
  date: string;
  /** Price sent to the channel for this night (standard occupancy), major units. */
  rack: number;
  /** Discounts in the order the channel applies them. */
  discounts: readonly GuestDiscount[];
};

export type StayFeeKind = 'cleaning' | 'pets' | 'other';

export type StayFee = { kind: StayFeeKind; label: string; amount: number };

export type GuestPriceInput = {
  nights: readonly StayNightInput[];
  /** Per-stay fees, never discounted (Booking, Airbnb). */
  fees?: readonly StayFee[];
  /** Taxes the channel adds on top of the price (city tax), per stay. */
  taxesOnTop?: readonly { label: string; amount: number }[];
  /** VAT (%) already inside the room price — reported, never added. Booking counts it on the room only. */
  vatIncludedPct?: number | null;
};

export type GuestPriceLineKind = 'rack' | GuestDiscountKind | StayFeeKind | 'tax';

export type GuestPriceLine = { kind: GuestPriceLineKind; label: string; amount: number };

export type GuestPriceBreakdown = {
  /** Rack, then every discount (negative), then fees and taxes — they add up to `total`. */
  lines: GuestPriceLine[];
  /** What Booking calls «Первоначальная цена»: room after the rate plan + fees. */
  original: number;
  /** Room after every discount, whole stay. */
  room: number;
  fees: number;
  taxesOnTop: number;
  total: number;
  /** VAT inside `room`; null when the rate is unknown. */
  vatIncluded: number | null;
  /** Room per night after every discount — what a minimum price must be checked against. */
  roomPerNight: { date: string; amount: number }[];
};

/** Money rounding to grosz / cents, as the channels show it. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clampPct(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

export function guestPriceBreakdown(input: GuestPriceInput): GuestPriceBreakdown {
  let rackTotal = 0;
  // Unrounded amount per discount line; Map keeps the order lines first appear in.
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
  // A discount that cut nothing (a zero rack) shows no line.
  const discountLines = [...discountTotals.values()]
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .filter((l) => l.amount !== 0);
  const feeLines: GuestPriceLine[] = (input.fees ?? [])
    .filter((f) => f.amount > 0)
    .map((f) => ({ kind: f.kind, label: f.label, amount: round2(f.amount) }));
  const taxLines: GuestPriceLine[] = (input.taxesOnTop ?? [])
    .filter((t) => t.amount > 0)
    .map((t) => ({ kind: 'tax' as const, label: t.label, amount: round2(t.amount) }));

  // Totals come from the rounded lines, so the lines always add up to what is shown.
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

/**
 * Booking discounts for one night, in Booking's order. Zero / missing ones are left out.
 * `dealPct` is the deal the guest sees — Basic / Last-minute / Early booker do not add up,
 * the highest wins (pricing-math.util.ts `findOverlaps`). The discounts multiply, so the order
 * changes only how the cut is split between lines, never the total.
 */
export function bookingNightDiscounts(p: {
  ratePlanPct?: number | null;
  ratePlanLabel?: string;
  geniusPct?: number | null;
  extraDiscounts?: readonly { label: string; pct: number }[] | null;
  dealPct?: number | null;
  dealLabel?: string;
  targetingPct?: number | null;
  targetingLabel?: string;
}): GuestDiscount[] {
  const out: GuestDiscount[] = [];
  if (p.ratePlanPct) out.push({ kind: 'rate_plan', label: p.ratePlanLabel ?? 'Тарифный план', pct: p.ratePlanPct });
  if (p.geniusPct) out.push({ kind: 'genius', label: 'Genius', pct: p.geniusPct });
  for (const x of p.extraDiscounts ?? []) if (x.pct) out.push({ kind: 'extra', label: x.label, pct: x.pct });
  if (p.dealPct) out.push({ kind: 'deal', label: p.dealLabel ?? 'Акция', pct: p.dealPct });
  if (p.targetingPct) {
    out.push({ kind: 'targeting', label: p.targetingLabel ?? 'Мобильная цена', pct: p.targetingPct });
  }
  return out;
}

/**
 * Airbnb length-of-stay discount: monthly from 28 nights, weekly from 7, none below.
 * Airbnb applies it to the nightly subtotal only — fees stay whole.
 */
export function airbnbLengthOfStayDiscount(
  nights: number,
  p: { weeklyPct?: number | null; monthlyPct?: number | null },
): GuestDiscount | null {
  if (nights >= 28 && p.monthlyPct) return { kind: 'length_of_stay', label: 'Скидка за месяц', pct: p.monthlyPct };
  if (nights >= 7 && p.weeklyPct) return { kind: 'length_of_stay', label: 'Скидка за неделю', pct: p.weeklyPct };
  return null;
}

/** Nights whose room price after every discount falls below the property minimum. */
export function nightsBelowMinPrice(
  breakdown: Pick<GuestPriceBreakdown, 'roomPerNight'>,
  minPrice: number | null | undefined,
): string[] {
  if (!minPrice || minPrice <= 0) return [];
  return breakdown.roomPerNight.filter((n) => n.amount < minPrice).map((n) => n.date);
}

/**
 * Calibration: RentAI's total vs the total a guest saw on the channel.
 * Outside the tolerance → some discount or fee RentAI does not know about is in play.
 */
export function compareWithObserved(
  calculatedTotal: number,
  observedTotal: number,
  tolerancePct = 1,
): { deltaPct: number; withinTolerance: boolean } {
  if (!(observedTotal > 0)) return { deltaPct: 0, withinTolerance: false };
  const deltaPct = round2(((calculatedTotal - observedTotal) / observedTotal) * 100);
  return { deltaPct, withinTolerance: Math.abs(deltaPct) <= tolerancePct };
}
