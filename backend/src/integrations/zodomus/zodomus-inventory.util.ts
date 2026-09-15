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
  if (isClosedFlag(rate.closed)) day.closed = true;
  if (isClosedFlag(rate.closedOnArrival)) day.closedOnArrival = true;
  if (isClosedFlag(rate.closedOnDeparture)) day.closedOnDeparture = true;

  const minArr = toNum(rate.minStayArrival ?? rate.minStay);
  if (minArr != null && minArr > 0) {
    day.minStayArrival = day.minStayArrival == null ? minArr : Math.max(day.minStayArrival, minArr);
  }
  const minThru = toNum(rate.minStayThrough);
  if (minThru != null && minThru > 0) {
    day.minStayThrough = day.minStayThrough == null ? minThru : Math.max(day.minStayThrough, minThru);
  }
}

/**
 * Walk arbitrary Zodomus availability JSON and collect per-date inventory + restrictions.
 * Handles both flat day nodes and nested `rates[]` under each day.
 */
export function extractZodomusInventoryDays(body: unknown): ZodomusInventoryDay[] {
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
      };
      byDate.set(date, d);
    }
    return d;
  };

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const n = node as Record<string, unknown>;
    const date = dayKeyFromNode(n);
    if (date) {
      const day = ensure(date);
      const avail = toNum(n.availability);
      if (avail != null) day.availability = avail;
      const booked = toNum(n.booked);
      if (booked != null) day.booked = booked;
      if (isClosedFlag(n.closed)) day.closed = true;
      if (isClosedFlag(n.closedOnArrival)) day.closedOnArrival = true;
      if (isClosedFlag(n.closedOnDeparture)) day.closedOnDeparture = true;
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
 * Days closed on the channel (avail=0 or booked>0) — for calendar overlay.
 * Does not include restriction-only days (min stay) as fully occupied.
 */
export function collectOtaBlockedDays(days: ZodomusInventoryDay[]): string[] {
  const blocked: string[] = [];
  for (const d of days) {
    if (d.availability === 0 || (d.booked != null && d.booked > 0)) {
      blocked.push(d.date);
    }
  }
  return blocked;
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
