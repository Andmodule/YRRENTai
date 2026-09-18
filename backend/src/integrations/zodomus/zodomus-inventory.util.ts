/**
 * Parse Zodomus GET /availability payloads and evaluate stay bookability
 * (inventory + rate restrictions such as minStay / closed).
 */

export type ZodomusInventoryDay = {
  date: string;
  availability: number | null;
  booked: number | null;
  closed: boolean;
  closedOnArrival: boolean;
  closedOnDeparture: boolean;
  minStayArrival: number | null;
  minStayThrough: number | null;
  /**
   * Nightly rack price in major units (Zodomus `price`).
   * Prefer max open rate for the night (typically Standard vs discounted child rates).
   */
  price: number | null;
};

export type OtaInventoryBlockReason =
  | 'OTA_UNAVAILABLE'
  | 'OTA_CLOSED'
  | 'OTA_CLOSED_ON_ARRIVAL'
  | 'OTA_CLOSED_ON_DEPARTURE'
  | 'OTA_MIN_STAY';

export type OtaStayInventoryResult =
  | { ok: true }
  | {
      ok: false;
      reason: OtaInventoryBlockReason;
      date?: string;
      minStayRequired?: number;
      nights?: number;
    };

export type OtaCalendarRestrictionHint = {
  date: string;
  kind: 'closed' | 'minStay' | 'closedOnArrival' | 'closedOnDeparture';
  minStay?: number;
};

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isClosedFlag(v: unknown): boolean {
  if (v === true || v === 1 || v === '1' || v === 'Yes' || v === 'yes') return true;
  return false;
}

function dayKeyFromNode(n: Record<string, unknown>): string | null {
  const raw = n.date ?? n.day ?? n.dateFrom;
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function mergeRateIntoDay(day: ZodomusInventoryDay, rate: Record<string, unknown>): void {
  const rateClosed = isClosedFlag(rate.closed);
  if (rateClosed) day.closed = true;
  if (isClosedFlag(rate.closedOnArrival)) day.closedOnArrival = true;
  if (isClosedFlag(rate.closedOnDeparture ?? rate.closedOnDepart)) day.closedOnDeparture = true;

  const minArr = toNum(rate.minStayArrival ?? rate.minStay);
  if (minArr != null && minArr > 0) {
    day.minStayArrival = day.minStayArrival == null ? minArr : Math.max(day.minStayArrival, minArr);
  }
  const minThru = toNum(rate.minStayThrough);
  if (minThru != null && minThru > 0) {
    day.minStayThrough = day.minStayThrough == null ? minThru : Math.max(day.minStayThrough, minThru);
  }

  if (!rateClosed) {
    const price = toNum(rate.price);
    if (price != null && price > 0) {
      day.price = day.price == null ? price : Math.max(day.price, price);
    }
  }
}

function mergeInventoryScalars(day: ZodomusInventoryDay, n: Record<string, unknown>): void {
  /**
   * Multi-room payloads: take the most restrictive inventory (min avail / max booked).
   * Last-write-wins previously made calendar look free when another room was open.
   */
  const avail = toNum(n.availability);
  if (avail != null) {
    day.availability = day.availability == null ? avail : Math.min(day.availability, avail);
  }
  const booked = toNum(n.booked);
  if (booked != null) {
    day.booked = day.booked == null ? booked : Math.max(day.booked, booked);
  }
  if (isClosedFlag(n.closed)) day.closed = true;
  if (isClosedFlag(n.closedOnArrival)) day.closedOnArrival = true;
  if (isClosedFlag(n.closedOnDeparture ?? n.closedOnDepart)) day.closedOnDeparture = true;
  const minArr = toNum(n.minStayArrival ?? n.minStay);
  if (minArr != null && minArr > 0) {
    day.minStayArrival = day.minStayArrival == null ? minArr : Math.max(day.minStayArrival, minArr);
  }
  const minThru = toNum(n.minStayThrough);
  if (minThru != null && minThru > 0) {
    day.minStayThrough = day.minStayThrough == null ? minThru : Math.max(day.minStayThrough, minThru);
  }
  const rates = n.rates;
  if (Array.isArray(rates)) {
    for (const r of rates) {
      if (r && typeof r === 'object') mergeRateIntoDay(day, r as Record<string, unknown>);
    }
  }
}

function roomIdOf(n: Record<string, unknown>): string | null {
  const raw = n.roomId ?? n.id;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return s || null;
}

function findRoomsArrays(body: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const n = node as Record<string, unknown>;
    const rooms = n.rooms;
    if (Array.isArray(rooms) && rooms.length > 0 && rooms.every((r) => r && typeof r === 'object')) {
      for (const r of rooms) out.push(r as Record<string, unknown>);
      return;
    }
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object') visit(v, depth + 1);
    }
  };
  visit(body, 0);
  return out;
}

export type ExtractZodomusInventoryOpts = {
  /** When set, only this room's dates are used (CRM zodomusRoomId). */
  preferRoomId?: string | null;
};

/**
 * Walk Zodomus availability JSON and collect per-date inventory + restrictions.
 * Prefers `rooms[].dates[]` when present; multi-room merges use min availability.
 */
export function extractZodomusInventoryDays(
  body: unknown,
  opts?: ExtractZodomusInventoryOpts,
): ZodomusInventoryDay[] {
  const byDate = new Map<string, ZodomusInventoryDay>();

  const ensure = (date: string): ZodomusInventoryDay => {
    let d = byDate.get(date);
    if (!d) {
      d = {
        date,
        availability: null,
        booked: null,
        closed: false,
        closedOnArrival: false,
        closedOnDeparture: false,
        minStayArrival: null,
        minStayThrough: null,
        price: null,
      };
      byDate.set(date, d);
    }
    return d;
  };

  const applyDateNode = (n: Record<string, unknown>): void => {
    const date = dayKeyFromNode(n);
    if (!date) return;
    mergeInventoryScalars(ensure(date), n);
  };

  const prefer = opts?.preferRoomId?.trim() || null;
  const rooms = findRoomsArrays(body);
  if (rooms.length > 0) {
    let selected = rooms;
    if (prefer) {
      const matched = rooms.filter((r) => roomIdOf(r) === prefer);
      if (matched.length > 0) selected = matched;
    }
    for (const room of selected) {
      const dates = room.dates;
      if (Array.isArray(dates)) {
        for (const d of dates) {
          if (d && typeof d === 'object') applyDateNode(d as Record<string, unknown>);
        }
      } else {
        applyDateNode(room);
      }
    }
    if (byDate.size > 0) {
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const n = node as Record<string, unknown>;
    applyDateNode(n);
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object') walk(v);
    }
  };

  walk(body);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Inclusive calendar nights: [checkIn, checkOut). */
export function enumerateStayNightKeys(checkInYmd: string, checkOutYmd: string): string[] {
  if (checkInYmd >= checkOutYmd) return [];
  const out: string[] = [];
  let cur = checkInYmd;
  while (cur < checkOutYmd) {
    out.push(cur);
    const [y, m, d] = cur.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = next.toISOString().slice(0, 10);
    if (out.length > 800) break;
  }
  return out;
}

export function evaluateStayAgainstInventory(
  days: ZodomusInventoryDay[],
  checkInYmd: string,
  checkOutYmd: string,
  nights: number,
): OtaStayInventoryResult {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const nightKeys = enumerateStayNightKeys(checkInYmd, checkOutYmd);

  for (const key of nightKeys) {
    const day = byDate.get(key);
    if (!day) continue;

    if (day.availability === 0 || (day.booked != null && day.booked > 0)) {
      return { ok: false, reason: 'OTA_UNAVAILABLE', date: key };
    }
    if (day.closed) {
      return { ok: false, reason: 'OTA_CLOSED', date: key };
    }
  }

  const arrival = byDate.get(checkInYmd);
  if (arrival?.closedOnArrival) {
    return { ok: false, reason: 'OTA_CLOSED_ON_ARRIVAL', date: checkInYmd };
  }
  if (arrival) {
    const required = Math.max(arrival.minStayArrival ?? 0, arrival.minStayThrough ?? 0);
    if (required > 0 && nights < required) {
      return {
        ok: false,
        reason: 'OTA_MIN_STAY',
        date: checkInYmd,
        minStayRequired: required,
        nights,
      };
    }
  }

  const departure = byDate.get(checkOutYmd);
  if (departure?.closedOnDeparture) {
    return { ok: false, reason: 'OTA_CLOSED_ON_DEPARTURE', date: checkOutYmd };
  }

  return { ok: true };
}

/**
 * Days closed on the channel — for calendar overlay.
 * Occupied = availability 0, booked > 0, or rate closed.
 * Does not treat min-stay-only nights as occupied bars.
 */
export function collectOtaBlockedDays(days: ZodomusInventoryDay[]): string[] {
  const blocked: string[] = [];
  for (const d of days) {
    if (d.availability === 0 || (d.booked != null && d.booked > 0) || d.closed) {
      blocked.push(d.date);
    }
  }
  return blocked;
}

/** Merge consecutive yyyy-MM-dd nights into [checkIn, checkOutExclusive) ranges. */
export function mergeBlockedDaysToRanges(
  days: string[],
): Array<{ checkIn: string; checkOut: string }> {
  const sorted = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (sorted.length === 0) return [];
  const ranges: Array<{ checkIn: string; checkOut: string }> = [];
  let start = sorted[0];
  let prev = sorted[0];
  const nextDay = (ymd: string): string => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === nextDay(prev)) {
      prev = cur;
      continue;
    }
    ranges.push({ checkIn: start, checkOut: nextDay(prev) });
    start = cur;
    prev = cur;
  }
  ranges.push({ checkIn: start, checkOut: nextDay(prev) });
  return ranges;
}

export function collectOtaRestrictionHints(days: ZodomusInventoryDay[]): OtaCalendarRestrictionHint[] {
  const hints: OtaCalendarRestrictionHint[] = [];
  for (const d of days) {
    if (d.closed) {
      hints.push({ date: d.date, kind: 'closed' });
    }
    if (d.closedOnArrival) {
      hints.push({ date: d.date, kind: 'closedOnArrival' });
    }
    if (d.closedOnDeparture) {
      hints.push({ date: d.date, kind: 'closedOnDeparture' });
    }
    const minStay = Math.max(d.minStayArrival ?? 0, d.minStayThrough ?? 0);
    if (minStay > 1) {
      hints.push({ date: d.date, kind: 'minStay', minStay });
    }
  }
  return hints;
}

/** Per-night rack prices (major units) for calendar / booking defaults. */
export function collectOtaNightlyPrices(days: ZodomusInventoryDay[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) {
    if (d.price != null && d.price > 0) {
      out[d.date] = d.price;
    }
  }
  return out;
}

/**
 * Sum nightly rack prices for [checkIn, checkOut).
 * Returns null if any stay night is missing a price.
 */
export function sumStayNightlyPrices(
  days: ZodomusInventoryDay[],
  checkInYmd: string,
  checkOutYmd: string,
): number | null {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const nightKeys = enumerateStayNightKeys(checkInYmd, checkOutYmd);
  if (nightKeys.length === 0) return null;
  let total = 0;
  for (const key of nightKeys) {
    const price = byDate.get(key)?.price;
    if (price == null || price <= 0) return null;
    total += price;
  }
  return Math.round(total * 100) / 100;
}

/** Sum from a date→price map (calendar overlay); null if any stay night missing. */
export function sumNightlyPriceMap(
  prices: Record<string, number> | undefined,
  checkInYmd: string,
  checkOutYmd: string,
): number | null {
  if (!prices || !checkInYmd || !checkOutYmd || checkInYmd >= checkOutYmd) return null;
  const nightKeys = enumerateStayNightKeys(checkInYmd, checkOutYmd);
  if (nightKeys.length === 0) return null;
  let total = 0;
  for (const key of nightKeys) {
    const price = prices[key];
    if (price == null || !(price > 0)) return null;
    total += price;
  }
  return Math.round(total * 100) / 100;
}
