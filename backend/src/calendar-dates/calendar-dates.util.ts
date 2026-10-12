/**
 * «Открыть / закрыть даты на Booking» — pure planning over ONE Booking room + rate.
 *
 * Booking nights that were never opened come back from GET /availability as `closed=1` on the rate
 * (with Booking's placeholder price). POST /rates with `closed:"0"` opens them, `closed:"1"` closes
 * them (checked on K22 Andersa on 2026-10-12: one night opened, read back, closed again).
 */

export type CalendarDatesAction = 'open' | 'close';

/** One night of the rate as Booking reports it. */
export type RateNight = {
  date: string;
  closed: boolean;
  /** Price of this rate on this night (major units); null = Booking sent none. */
  price: number | null;
  /** Rooms sold on the channel that night (date or rate level, whichever is larger). */
  booked: number;
  /** Rooms for sale that night (date level); null = Booking sent none. */
  availability?: number | null;
};

export type NightChange = {
  date: string;
  /** Price sent with the night (Booking needs one in every POST /rates). */
  price: number;
  closed: boolean;
  fromPrice: number | null;
  fromClosed: boolean;
};

export type SkipReason =
  /** A booking or block in RentAI covers the night. */
  | 'crm'
  /** Sold on the channel, or no room for sale that night (availability 0). */
  | 'booked'
  /** «Как сейчас на Booking», but that price is below the property's minimum price. */
  | 'belowMin'
  /** Booking did not report the night for this rate. */
  | 'missing'
  /** Its day of the week is not selected. */
  | 'weekday'
  /** Already as asked. */
  | 'unchanged'
  /** «Оставить цену», but Booking has no price for the night. */
  | 'noPrice'
  /** Closed by hand beyond the auto-extension edge — auto-extension leaves it closed. */
  | 'keepClosed';

export type CalendarDatesPlanInput = {
  action: CalendarDatesAction;
  dateFrom: string;
  /** Exclusive end (the day after the last night). */
  dateToExclusive: string;
  /** 0 = Sunday … 6 = Saturday; empty / missing = every day. */
  weekdays?: readonly number[] | null;
  /** Price of the opened nights; missing = each night keeps the price Booking has. Ignored on «close». */
  price?: number | null;
  /** Price of Friday and Saturday nights; missing = `price`. */
  weekendPrice?: number | null;
  /** Auto-extension: only closed nights are opened; nights already open keep their price. */
  onlyClosed?: boolean;
};

export type CalendarDatesPlan = {
  /** Nights in the range. */
  nights: number;
  changes: NightChange[];
  skipped: Record<SkipReason, number>;
  /**
   * «close»: nights that are closed on Booking already (nothing to send). Auto-extension still has to
   * remember them as closed by hand, or it would open them when its edge gets there.
   */
  alreadyClosed: string[];
};

/** A run of consecutive nights sent in one POST /rates. */
export type ChangeRange = {
  dateFrom: string;
  dateToExclusive: string;
  price: number;
  closed: boolean;
  nights: number;
};

/**
 * Zodomus refuses GET /availability longer than one month («date difference is bigger than 1 month»,
 * seen 2026-10-12). 28 nights stay inside a month whatever the month; POST ranges use the same size.
 */
export const MAX_WINDOW_NIGHTS = 28;
/** Longest range one request may cover. */
export const MAX_RANGE_NIGHTS = 366;
/** POST /rates per run; beyond that the person is asked for a shorter range or one price. */
export const MAX_WRITE_REQUESTS = 200;
/** Nights that count as «выходные»: Friday and Saturday nights. */
export const WEEKEND_NIGHTS: readonly number[] = [5, 6];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function utcNoon(ymd: string): number {
  return Date.parse(`${ymd}T12:00:00.000Z`);
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(utcNoon(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A real calendar date between 2000 and 2100. The round trip rejects «2026-02-30» (JS rolls it over to
 * March) and «9999-99-99»; the year bounds keep every loop over dates short.
 */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false;
  const year = Number(v.slice(0, 4));
  if (year < 2000 || year > 2100 || Number.isNaN(utcNoon(v))) return false;
  return addDaysYmd(v, 0) === v;
}

/** Nights in [from, toExclusive); NaN when a date is not a real date. */
export function nightsBetween(from: string, toExclusive: string): number {
  if (!isYmd(from) || !isYmd(toExclusive)) return Number.NaN;
  return Math.max(0, Math.round((utcNoon(toExclusive) - utcNoon(from)) / 86_400_000));
}

function assertRange(from: string, toExclusive: string): void {
  if (!isYmd(from) || !isYmd(toExclusive)) throw new RangeError(`Not a date range: ${from} → ${toExclusive}`);
}

export function nightKeys(from: string, toExclusive: string): string[] {
  assertRange(from, toExclusive);
  const out: string[] = [];
  for (let cur = from; cur < toExclusive; cur = addDaysYmd(cur, 1)) out.push(cur);
  return out;
}

/** 0 = Sunday … 6 = Saturday — of the calendar date itself, independent of any time zone. */
export function weekdayOf(ymd: string): number {
  return new Date(utcNoon(ymd)).getUTCDay();
}

export function isWeekendNight(ymd: string): boolean {
  return WEEKEND_NIGHTS.includes(weekdayOf(ymd));
}

/** [from, toExclusive) cut into windows of at most `max` nights. */
export function splitWindows(
  from: string,
  toExclusive: string,
  max = MAX_WINDOW_NIGHTS,
): { dateFrom: string; dateToExclusive: string }[] {
  assertRange(from, toExclusive);
  const out: { dateFrom: string; dateToExclusive: string }[] = [];
  let cur = from;
  while (cur < toExclusive) {
    const next = addDaysYmd(cur, max);
    const end = next < toExclusive ? next : toExclusive;
    out.push({ dateFrom: cur, dateToExclusive: end });
    cur = end;
  }
  return out;
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isClosedFlag(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'Yes' || v === 'yes';
}

function findRooms(body: unknown): Record<string, unknown>[] {
  const visit = (node: unknown, depth: number): Record<string, unknown>[] | null => {
    if (!node || typeof node !== 'object' || depth > 5) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = visit(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.rooms) && n.rooms.every((r) => r && typeof r === 'object')) {
      return n.rooms as Record<string, unknown>[];
    }
    for (const v of Object.values(n)) {
      const hit = visit(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return visit(body, 0) ?? [];
}

/**
 * Nights of one room + rate from a GET /availability body
 * (`rooms[].dates[].rates[]`, the shape Zodomus returns for Booking).
 * When the room id is not found but there is a single room, that room is used.
 */
export function extractRateNights(body: unknown, roomId: string, rateId: string): Map<string, RateNight> {
  const out = new Map<string, RateNight>();
  const rooms = findRooms(body);
  const wantRoom = roomId.trim();
  const wantRate = rateId.trim();
  let room = rooms.find((r) => String(r.id ?? r.roomId ?? '').trim() === wantRoom);
  if (!room && rooms.length === 1) room = rooms[0];
  const dates = room && Array.isArray(room.dates) ? room.dates : [];
  for (const d of dates) {
    if (!d || typeof d !== 'object') continue;
    const node = d as Record<string, unknown>;
    const date = typeof node.date === 'string' ? node.date.trim().slice(0, 10) : '';
    if (!YMD.test(date)) continue;
    const rates = Array.isArray(node.rates) ? node.rates : [];
    const rate = rates.find(
      (r) =>
        r &&
        typeof r === 'object' &&
        String((r as Record<string, unknown>).rateId ?? (r as Record<string, unknown>).id ?? '').trim() === wantRate,
    ) as Record<string, unknown> | undefined;
    if (!rate) continue;
    const price = toNum(rate.price);
    out.set(date, {
      date,
      closed: isClosedFlag(rate.closed),
      price: price != null && price > 0 ? price : null,
      booked: Math.max(toNum(node.booked) ?? 0, toNum(rate.booked) ?? 0),
      availability: toNum(node.availability),
    });
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 0.005;
}

export function emptySkipped(): Record<SkipReason, number> {
  return { crm: 0, booked: 0, belowMin: 0, missing: 0, weekday: 0, unchanged: 0, noPrice: 0, keepClosed: 0 };
}

/**
 * Which nights change and why the others do not. Never touches a night that is sold on the channel,
 * has no room for sale, or is covered by a booking / block in RentAI; never opens a night below
 * `minPrice` (a price that was typed in is refused before planning — this catches «as on Booking»).
 */
export function planCalendarDates(
  nights: ReadonlyMap<string, RateNight>,
  input: CalendarDatesPlanInput,
  opts: { crmBlocked?: ReadonlySet<string>; keepClosed?: ReadonlySet<string>; minPrice?: number | null } = {},
): CalendarDatesPlan {
  const skipped = emptySkipped();
  const days = input.weekdays && input.weekdays.length > 0 ? new Set(input.weekdays) : null;
  const wantClosed = input.action === 'close';
  const keys = nightKeys(input.dateFrom, input.dateToExclusive);
  const changes: NightChange[] = [];
  const alreadyClosed: string[] = [];

  for (const date of keys) {
    if (days && !days.has(weekdayOf(date))) {
      skipped.weekday++;
      continue;
    }
    if (opts.crmBlocked?.has(date)) {
      skipped.crm++;
      continue;
    }
    const night = nights.get(date);
    if (!night) {
      skipped.missing++;
      continue;
    }
    if (night.booked > 0 || night.availability === 0) {
      skipped.booked++;
      continue;
    }
    if (input.onlyClosed && !night.closed) {
      skipped.unchanged++;
      continue;
    }
    if (!wantClosed && opts.keepClosed?.has(date)) {
      skipped.keepClosed++;
      continue;
    }
    const asked = !wantClosed
      ? (isWeekendNight(date) && input.weekendPrice != null ? input.weekendPrice : input.price) ?? null
      : null;
    const price = asked ?? night.price;
    if (price == null || !(price > 0)) {
      skipped.noPrice++;
      continue;
    }
    if (night.closed === wantClosed && samePrice(night.price, price)) {
      if (wantClosed) alreadyClosed.push(date);
      skipped.unchanged++;
      continue;
    }
    if (!wantClosed && opts.minPrice != null && price < opts.minPrice) {
      skipped.belowMin++;
      continue;
    }
    changes.push({
      date,
      price: round2(price),
      closed: wantClosed,
      fromPrice: night.price,
      fromClosed: night.closed,
    });
  }
  return { nights: keys.length, changes, skipped, alreadyClosed };
}

/** Consecutive nights with the same price and state → one POST /rates each (at most `max` nights). */
export function mergeChangesToRanges(changes: readonly NightChange[], max = MAX_WINDOW_NIGHTS): ChangeRange[] {
  const sorted = [...changes].sort((a, b) => a.date.localeCompare(b.date));
  const out: ChangeRange[] = [];
  let cur: ChangeRange | null = null;
  for (const c of sorted) {
    if (
      cur &&
      cur.dateToExclusive === c.date &&
      cur.closed === c.closed &&
      samePrice(cur.price, c.price) &&
      cur.nights < max
    ) {
      cur.dateToExclusive = addDaysYmd(c.date, 1);
      cur.nights++;
      continue;
    }
    cur = { dateFrom: c.date, dateToExclusive: addDaysYmd(c.date, 1), price: c.price, closed: c.closed, nights: 1 };
    out.push(cur);
  }
  return out;
}

/** Nights Booking reports differently from what was sent (read back after the writes). */
export function findMismatches(changes: readonly NightChange[], after: ReadonlyMap<string, RateNight>): string[] {
  const out: string[] = [];
  for (const c of changes) {
    const n = after.get(c.date);
    if (!n || n.closed !== c.closed || !samePrice(n.price, c.price)) out.push(c.date);
  }
  return out;
}

/** Counts for the summary: nights opened, closed, only re-priced. */
export function countChanges(changes: readonly NightChange[]): { open: number; close: number; price: number } {
  let open = 0;
  let close = 0;
  let price = 0;
  for (const c of changes) {
    if (c.closed && !c.fromClosed) close++;
    else if (!c.closed && c.fromClosed) open++;
    else price++;
  }
  return { open, close, price };
}
