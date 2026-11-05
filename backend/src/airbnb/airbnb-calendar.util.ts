/**
 * The Airbnb calendar of the pilot listing, computed from Booking (owner's rule 2026-10-29): the price of a
 * night on Airbnb = what a regular guest sees on Booking for that night — the main rate minus the biggest
 * active Basic deal. Airbnb takes its fee from the host only (checked in the host's account 2026-10-29:
 * «Цена для гостей 290 zł», «Сервисный сбор с хозяина −45 zł»), so the guest pays that price as it is.
 * Genius, Mobile, Last-minute and Early booker are left out: only some Booking guests get them, and
 * Airbnb has one price per day.
 */

export interface BookingNightForAirbnb {
  date: string;
  /** Main Booking rate of the night (major units), null when Booking sent none. */
  rack: number | null;
  /** Closed for sale on Booking (rate closed or no room). */
  closed: boolean;
}

export interface BasicDeal {
  pct: number;
  from: string;
  to: string;
  /** 'Mon'…'Sun'; null or empty = every day. */
  weekdays: readonly string[] | null;
}

export interface AirbnbNight {
  date: string;
  /** null — not for sale on Airbnb (no price to give it). */
  price: number | null;
  /** Occupied in RentAI (booking or block). */
  occupied: boolean;
}

export interface AirbnbCalendarOperation {
  dates: string[];
  availability: 'available' | 'unavailable';
  dailyPrice?: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayOfYmd(ymd: string): string {
  return WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()]!;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The biggest Basic deal on the night (Basic deals do not add up on Booking: the guest sees the biggest). */
export function basicPctOn(date: string, deals: readonly BasicDeal[]): number {
  let best = 0;
  const day = weekdayOfYmd(date);
  for (const d of deals) {
    if (date < d.from || date > d.to) continue;
    if (d.weekdays && d.weekdays.length > 0 && !d.weekdays.includes(day)) continue;
    if (Number.isFinite(d.pct) && d.pct > best && d.pct < 100) best = d.pct;
  }
  return best;
}

/** Whole złoty, as Airbnb shows prices; never below `min` when one is set. */
export function airbnbPrice(rack: number, pct: number, min: number | null): number {
  const p = Math.round(rack * (1 - pct / 100));
  return min != null && p < min ? Math.ceil(min) : p;
}

/**
 * Owner's rule 2026-11-05 (ZODOMUS_AIRBNB_PRICE_FROM_BASE): the Airbnb price of a night is RentAI's own —
 * the price typed for Airbnb on that night, else the base price with the Airbnb markup («Airbnb — базовая
 * −N %»). Whole złoty, never below `min`. Nights with neither are left out (they keep the Booking rule).
 */
export function ownAirbnbPrices(
  dates: readonly string[],
  base: ReadonlyMap<string, number>,
  typed: ReadonlyMap<string, number>,
  markupPct: number | null | undefined,
  min: number | null,
): Map<string, number> {
  const pct = Number.isFinite(markupPct) ? (markupPct as number) : 0;
  const out = new Map<string, number>();
  for (const d of dates) {
    const t = typed.get(d);
    const b = base.get(d);
    let p: number | null = null;
    if (t != null && t > 0) p = Math.round(t);
    else if (b != null && b > 0) p = Math.round((b * (100 + pct)) / 100);
    if (p == null || !(p > 0)) continue;
    out.set(d, min != null && p < min ? Math.ceil(min) : p);
  }
  return out;
}

/**
 * Booking nights + deals + RentAI occupancy → the Airbnb night list. A night closed on Booking has no price.
 * `own` (RentAI's own Airbnb prices) wins over the Booking rule on a night open on Booking.
 */
export function airbnbNights(
  booking: ReadonlyMap<string, BookingNightForAirbnb>,
  dates: readonly string[],
  deals: readonly BasicDeal[],
  occupied: ReadonlySet<string>,
  minPrice: number | null,
  own?: ReadonlyMap<string, number> | null,
): AirbnbNight[] {
  return dates.map((date) => {
    const b = booking.get(date);
    let price: number | null = null;
    if (b && !b.closed) {
      const o = own?.get(date);
      if (o != null) price = o;
      else if (b.rack != null && b.rack > 0) price = airbnbPrice(b.rack, basicPctOn(date, deals), minPrice);
    }
    return { date, price, occupied: occupied.has(date) };
  });
}

function forSale(n: AirbnbNight): boolean {
  return !n.occupied && n.price != null;
}

function opKey(n: AirbnbNight): string {
  return `${forSale(n) ? 'a' : 'x'}:${n.price ?? '-'}`;
}

/**
 * Consecutive nights with the same state and price → one operation `"from:to"` (both ends included, as in
 * the Zodomus docs). For sale = free in RentAI and priced. The price goes with every night that has one —
 * an occupied night too, so that when it frees up Airbnb already holds the Booking price, not the listing's.
 */
export function calendarOperations(nights: readonly AirbnbNight[]): AirbnbCalendarOperation[] {
  const sorted = [...nights].sort((a, b) => a.date.localeCompare(b.date));
  const out: AirbnbCalendarOperation[] = [];
  let start: AirbnbNight | null = null;
  let last: AirbnbNight | null = null;
  const flush = () => {
    if (!start || !last) return;
    out.push({
      dates: [`${start.date}:${last.date}`],
      availability: forSale(start) ? 'available' : 'unavailable',
      ...(start.price != null ? { dailyPrice: start.price } : {}),
    });
  };
  for (const n of sorted) {
    if (start && last && opKey(n) === opKey(start) && addDaysYmd(last.date, 1) === n.date) {
      last = n;
      continue;
    }
    flush();
    start = n;
    last = n;
  }
  flush();
  return out;
}

/** Everything from `planEnd` for `days` days unavailable: RentAI does not guard those nights yet. */
export function closedTail(planEnd: string, days: number): AirbnbCalendarOperation {
  return { dates: [`${planEnd}:${addDaysYmd(planEnd, days - 1)}`], availability: 'unavailable' };
}

/**
 * Availability only (after a booking, a cancellation, a block). An occupied night is always closed — even
 * past the last full send or after a failed one. A free night opens again only inside the last full send
 * (`< planEnd`) and where it had a price (`noPrice` holds the nights it left without one); otherwise it is
 * sent unavailable too.
 */
export function availabilityOperations(
  days: readonly { date: string; free: boolean }[],
  noPrice: ReadonlySet<string>,
  planEnd: string | null,
): AirbnbCalendarOperation[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const out: AirbnbCalendarOperation[] = [];
  let from: string | null = null;
  let to: string | null = null;
  let open = false;
  const flush = () => {
    if (from && to) out.push({ dates: [`${from}:${to}`], availability: open ? 'available' : 'unavailable' });
  };
  for (const d of sorted) {
    const o = d.free && planEnd != null && d.date < planEnd && !noPrice.has(d.date);
    if (from && to && o === open && addDaysYmd(to, 1) === d.date) {
      to = d.date;
      continue;
    }
    flush();
    from = d.date;
    to = d.date;
    open = o;
  }
  flush();
  return out;
}

/** A night «Открыть / закрыть продажи» changed on Booking (the price is the main rate it sent). */
export interface BookingDateChange {
  date: string;
  price: number;
  closed: boolean;
}

/**
 * «Открыть / закрыть продажи» changed nights on Booking: the same nights on Airbnb. A closed night goes
 * unavailable and is remembered as having no price, so a later booking update does not reopen it; an opened
 * night goes available with the price a regular Booking guest gets (or stays unavailable when it is occupied
 * in RentAI or has no price). Nights from `planEnd` on are left to the closed tail: RentAI does not guard them.
 */
export function dateChangeOperations(
  changes: readonly BookingDateChange[],
  alreadyClosed: readonly string[],
  deals: readonly BasicDeal[],
  occupied: ReadonlySet<string>,
  minPrice: number | null,
  planEnd: string | null,
  noPrice: readonly string[],
  own?: ReadonlyMap<string, number> | null,
): { ops: AirbnbCalendarOperation[]; noPriceNights: string[] } {
  const booking = new Map<string, BookingNightForAirbnb>();
  for (const date of alreadyClosed) booking.set(date, { date, rack: null, closed: true });
  for (const c of changes) booking.set(c.date, { date: c.date, rack: c.price, closed: c.closed });
  const dates = [...booking.keys()].filter((d) => planEnd != null && d < planEnd).sort();
  const nights = airbnbNights(booking, dates, deals, occupied, minPrice, own);
  const left = new Set(noPrice);
  for (const n of nights) {
    if (n.price == null) left.add(n.date);
    else left.delete(n.date);
  }
  return { ops: calendarOperations(nights), noPriceNights: [...left].sort() };
}

/** At most `size` operations per POST /airbnb-calendar. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Stable short text of what would be sent — the person sends only what they checked. */
export function operationsFingerprint(listingId: string, ops: readonly AirbnbCalendarOperation[]): string {
  let h = 2166136261;
  const s = `${listingId}|${JSON.stringify(ops)}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + `-${ops.length}`;
}
