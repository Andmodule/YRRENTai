/**
 * Segment free OTA nights from GET /availability for POST /rates.
 * Free = booked==0 (or null) AND availability != 0 AND not closed.
 */

import {
  enumerateStayNightKeys,
  type ZodomusInventoryDay,
} from './zodomus-inventory.util';

export type RatesDateRange = {
  dateFrom: string;
  dateToExclusive: string;
};

/** Night is open for a price push (ARI free, not rate-closed). */
export function isOtaFreeNight(day: ZodomusInventoryDay): boolean {
  if (day.closed) return false;
  if (day.availability == null || day.availability === 0) return false;
  if (day.booked != null && day.booked > 0) return false;
  return true;
}

/**
 * Free night keys within [dateFrom, dateToExclusive), excluding CRM-blocked nights.
 * Days present in ARI but not free are skipped; nights missing from ARI are skipped
 * (cannot confirm free without inventory).
 */
export function collectFreeNightKeys(
  days: ZodomusInventoryDay[],
  dateFrom: string,
  dateToExclusive: string,
  crmBlockedKeys?: ReadonlySet<string> | readonly string[],
): string[] {
  const blocked =
    crmBlockedKeys instanceof Set
      ? crmBlockedKeys
      : new Set(crmBlockedKeys ?? []);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: string[] = [];
  for (const key of enumerateStayNightKeys(dateFrom, dateToExclusive)) {
    if (blocked.has(key)) continue;
    const day = byDate.get(key);
    if (!day || !isOtaFreeNight(day)) continue;
    out.push(key);
  }
  return out;
}

/** Merge consecutive yyyy-MM-dd nights into [dateFrom, dateToExclusive) ranges. */
export function mergeNightKeysToRanges(keys: string[]): RatesDateRange[] {
  const sorted = [...new Set(keys.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (sorted.length === 0) return [];

  const nextDay = (ymd: string): string => {
    const parts = ymd.split('-').map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y == null || m == null || d == null) return ymd;
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };

  const ranges: RatesDateRange[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur === nextDay(prev)) {
      prev = cur;
      continue;
    }
    ranges.push({ dateFrom: start, dateToExclusive: nextDay(prev) });
    start = cur;
    prev = cur;
  }
  ranges.push({ dateFrom: start, dateToExclusive: nextDay(prev) });
  return ranges;
}

/**
 * True if `rateId` appears under the given room (or anywhere if room unmatched)
 * in a GET /availability payload — avoids POST /rates 400 "not mapped".
 */
export function rateIdPresentInAvailability(
  body: unknown,
  roomId: string,
  rateId: string,
): boolean {
  const wantRoom = roomId.trim();
  const wantRate = rateId.trim();
  if (!wantRate) return false;

  let found = false;
  const visit = (node: unknown, depth: number, inPreferredRoom: boolean): void => {
    if (found || !node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1, inPreferredRoom);
      return;
    }
    const n = node as Record<string, unknown>;
    const nodeRoom = n.roomId ?? n.id;
    let roomCtx = inPreferredRoom;
    if (nodeRoom != null && String(nodeRoom).trim() !== '') {
      roomCtx = String(nodeRoom).trim() === wantRoom;
    }

    const rates = n.rates;
    if (Array.isArray(rates)) {
      for (const r of rates) {
        if (!r || typeof r !== 'object') continue;
        const rid = String(
          (r as Record<string, unknown>).rateId ?? (r as Record<string, unknown>).id ?? '',
        ).trim();
        if (rid === wantRate && (roomCtx || !wantRoom)) {
          found = true;
          return;
        }
      }
    }

    const inlineRate = n.rateId;
    if (inlineRate != null && String(inlineRate).trim() === wantRate && (roomCtx || !wantRoom)) {
      found = true;
      return;
    }

    for (const v of Object.values(n)) {
      if (v && typeof v === 'object') visit(v, depth + 1, roomCtx);
    }
  };

  visit(body, 0, false);
  return found;
}
