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

/** Booking nights + deals + RentAI occupancy → the Airbnb night list. A night closed on Booking has no price. */
export function airbnbNights(
  booking: ReadonlyMap<string, BookingNightForAirbnb>,
  dates: readonly string[],
  deals: readonly BasicDeal[],
  occupied: ReadonlySet<string>,
  minPrice: number | null,
): AirbnbNight[] {
  return dates.map((date) => {
    const b = booking.get(date);
    const price = b && !b.closed && b.rack != null && b.rack > 0 ? airbnbPrice(b.rack, basicPctOn(date, deals), minPrice) : null;
    return { date, price, occupied: occupied.has(date) };
  });
}

function opKey(n: AirbnbNight): string {
  return n.occupied || n.price == null ? 'x' : `a:${n.price}`;
}

/**
 * Consecutive nights with the same state → one operation `"from:to"` (both ends included, as in the Zodomus
 * docs). For sale = free in RentAI and priced; anything else is sent unavailable (with no price).
 */
export function calendarOperations(nights: readonly AirbnbNight[]): AirbnbCalendarOperation[] {
  const sorted = [...nights].sort((a, b) => a.date.localeCompare(b.date));
  const out: AirbnbCalendarOperation[] = [];
  let start: AirbnbNight | null = null;
  let last: AirbnbNight | null = null;
  const flush = () => {
    if (!start || !last) return;
    const forSale = opKey(start) !== 'x';
    out.push({
      dates: [`${start.date}:${last.date}`],
      availability: forSale ? 'available' : 'unavailable',
      ...(forSale ? { dailyPrice: start.price! } : {}),
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

/**
 * Availability only (after a booking, a cancellation, a block): free nights open again only where the last
 * full send had a price — `noPrice` holds the nights it sent unavailable for want of one.
 */
export function availabilityOperations(
  days: readonly { date: string; free: boolean }[],
  noPrice: ReadonlySet<string>,
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
    const o = d.free && !noPrice.has(d.date);
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
