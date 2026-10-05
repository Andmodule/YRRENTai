/**
 * Booking.com Promotions via Zodomus (GET/POST /promotions, /activate-promotion, /deactivate-promotion).
 *
 * GET /promotions mirrors Booking's XML: `{ promotions: [ { "@attributes": { id, name, type, ... },
 * stay_date: { "@attributes": { start, end }, active_weekdays: { active_weekday: [...] } },
 * rooms: { room: [ { "@attributes": { id } } ] }, parent_rates: { parent_rate: {...} },
 * discount: { "@attributes": { value } }, stats: {...} } ] }` — single children come as objects,
 * several as arrays. POST /promotions returns the new id in `status.promotionId`.
 * Parsers also accept a plain camelCase JSON shape in case Zodomus normalizes it later.
 */

import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { formatZodomusHttpException } from './zodomus-status.util';

export const BOOKING_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type BookingWeekday = (typeof BOOKING_WEEKDAYS)[number];

export type ParsedPromotionStats = {
  revenue: number | null;
  currency: string | null;
  nights: number | null;
  bookings: number | null;
  cancellations: number | null;
};

export type ParsedPromotion = {
  id: string;
  name: string;
  type: string | null;
  /** `active` attribute when present (sandbox sends "1"). */
  active: boolean | null;
  discountPct: number | null;
  targetChannel: string | null;
  stayStart: string | null;
  stayEnd: string | null;
  weekdays: BookingWeekday[];
  excludedDates: string[];
  roomIds: string[];
  rateIds: string[];
  lastMinute: { unit: string; value: number } | null;
  earlyBookerDays: number | null;
  stats: ParsedPromotionStats | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

/** `@attributes` block of an XML-ish node, or the node itself for plain JSON. */
function attrs(node: unknown): Record<string, unknown> {
  if (!isRecord(node)) return {};
  const a = node['@attributes'];
  return isRecord(a) ? { ...node, ...a } : node;
}

/** Booking uses "-1" for "not set". */
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === '-1') return null;
  return s;
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined) return o[k];
  }
  return undefined;
}

function ymd(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeWeekday(v: unknown): BookingWeekday | null {
  const s = str(v);
  if (!s) return null;
  const hit = BOOKING_WEEKDAYS.find((d) => d.toLowerCase() === s.slice(0, 3).toLowerCase());
  return hit ?? null;
}

/** Ids from `{ room: [...] }`, `{ room: {...} }`, `[{ id }]` or `['id']`. */
function idsFrom(container: unknown, childKey: string): string[] {
  const list =
    isRecord(container) && container[childKey] !== undefined
      ? asArray(container[childKey])
      : asArray(container);
  const out: string[] = [];
  for (const item of list) {
    const id = isRecord(item) ? str(attrs(item).id ?? attrs(item)[`${childKey}Id`]) : str(item);
    if (id) out.push(id);
  }
  return out;
}

function parseStats(node: unknown): ParsedPromotionStats | null {
  if (!isRecord(node)) return null;
  const revenueRaw = pick(node, 'total_revenue', 'totalRevenue');
  const revenueAttrs = attrs(revenueRaw);
  return {
    revenue: isRecord(revenueRaw) ? num(revenueAttrs.value) : num(revenueRaw),
    currency: str(revenueAttrs.currency ?? node.currency),
    nights: num(pick(node, 'nr_room_nights', 'nrRoomNights', 'roomNights')),
    bookings: num(pick(node, 'nr_bookings', 'nrBookings', 'bookings')),
    cancellations: num(pick(node, 'nr_cancellations', 'nrCancellations', 'cancellations')),
  };
}

export function parsePromotion(node: unknown): ParsedPromotion | null {
  if (!isRecord(node)) return null;
  const a = attrs(node);
  const id = str(a.id ?? a.promotionId);
  if (!id) return null;

  const stay = pick(node, 'stay_date', 'stayDate');
  const stayA = attrs(stay);
  const weekdaysContainer = isRecord(stay)
    ? pick(stay, 'active_weekdays', 'activeWeekdays')
    : undefined;
  const weekdays = idsOrValues(weekdaysContainer, 'active_weekday')
    .map(normalizeWeekday)
    .filter((d): d is BookingWeekday => d !== null);
  const excludedContainer = isRecord(stay)
    ? pick(stay, 'excluded_dates', 'excludedDates')
    : undefined;
  const excludedDates = idsOrValues(excludedContainer, 'excluded_date')
    .map(ymd)
    .filter((d): d is string => d !== null);

  const discountNode = pick(node, 'discount');
  const discountPct = isRecord(discountNode) ? num(attrs(discountNode).value) : num(discountNode);

  const lmA = attrs(pick(node, 'last_minute', 'lastMinute'));
  const lmUnit = str(lmA.unit);
  const lmValue = num(lmA.value);
  const ebA = attrs(pick(node, 'early_booker', 'earlyBooker'));

  const activeRaw = str(a.active);
  return {
    id,
    name: str(a.name) ?? '',
    type: str(a.type),
    active: activeRaw === null ? null : activeRaw === '1' || activeRaw.toLowerCase() === 'true',
    discountPct,
    targetChannel: str(pick(a, 'target_channel', 'targetChannel')),
    stayStart: ymd(stayA.start),
    stayEnd: ymd(stayA.end),
    weekdays,
    excludedDates,
    roomIds: idsFrom(pick(node, 'rooms'), 'room'),
    rateIds: idsFrom(pick(node, 'parent_rates', 'parentRates'), 'parent_rate'),
    lastMinute: lmUnit && lmValue !== null ? { unit: lmUnit, value: lmValue } : null,
    earlyBookerDays: num(ebA.value),
    stats: parseStats(pick(node, 'stats')),
  };
}

/** Plain string values from `{ active_weekday: [...] }`, `{ active_weekday: 'Fri' }` or `['Mon', ...]`. */
function idsOrValues(container: unknown, childKey: string): unknown[] {
  if (isRecord(container)) return asArray(container[childKey]);
  return asArray(container);
}

/** GET /promotions → parsed list (empty when the shape is unexpected). */
export function parsePromotionsResponse(body: unknown): ParsedPromotion[] {
  if (!isRecord(body)) return [];
  const raw = body.promotions;
  const list = isRecord(raw) && raw.promotion !== undefined ? asArray(raw.promotion) : asArray(raw);
  return list.map(parsePromotion).filter((p): p is ParsedPromotion => p !== null);
}

/** POST /promotions → new promotion id (Zodomus puts it in `status.promotionId`). */
export function extractPromotionId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const status = isRecord(body.status) ? body.status : {};
  const promotion = isRecord(body.promotion) ? body.promotion : {};
  return (
    str(status.promotionId) ?? str(body.promotionId) ?? str(body.id) ?? str(attrs(promotion).id)
  );
}

export type BasicPromotionInput = {
  channelId: number;
  externalPropertyId: string;
  /**
   * Name shown in the Booking extranet = RentAI marker (`RentAI 1a2b3c4d-1`), used to find the
   * promotion again on retries. The human name stays in RentAI (Zodomus allows only 20 chars).
   */
  marker: string;
  discountPct: number;
  /** Inclusive yyyy-MM-dd. */
  stayFrom: string;
  /** Inclusive yyyy-MM-dd. */
  stayTo: string;
  /** null = all seven days. */
  weekdays: BookingWeekday[] | null;
  roomIds: string[];
  rateIds: string[];
};

/**
 * Zodomus rejects longer names: "Name string cannot be longer than 20 chars" (sandbox, 2026-10-05).
 * Booking itself allows 255, Guesty also caps at 20. Keep it ASCII — the limit may count bytes.
 */
export const PROMOTION_NAME_MAX = 20;

/** Name sent to Booking: the ASCII marker, never longer than the Zodomus limit. */
export function buildPromotionName(marker: string): string {
  return marker.replace(/[^\x20-\x7e]/g, '').slice(0, PROMOTION_NAME_MAX);
}

/**
 * Body for POST /promotions — Booking «Basic deal», public audience, bookable right away (no book_date).
 * min_stay_through "0" = inherit the rate plan's minimum stay (does not loosen restrictions).
 */
export function buildBasicPromotionPayload(input: BasicPromotionInput): Record<string, unknown> {
  return {
    channelId: input.channelId,
    propertyId: input.externalPropertyId,
    name: buildPromotionName(input.marker),
    type: 'basic',
    targetChannel: 'public',
    minStayThrough: '0',
    nonRefundable: '0',
    noCcPromotion: '0',
    stayDate: {
      start: input.stayFrom,
      end: input.stayTo,
      activeWeekdays:
        input.weekdays && input.weekdays.length > 0 ? [...input.weekdays] : [...BOOKING_WEEKDAYS],
      excludedDates: [],
    },
    rooms: input.roomIds.map((id) => ({ id })),
    parentRates: input.rateIds.map((id) => ({ id })),
    discount: String(input.discountPct),
  };
}

export type PromotionErrorKind =
  | 'ACCESS_DENIED'
  | 'HOTEL_INELIGIBLE'
  | 'PROPERTY_NOT_ACTIVE'
  | 'INVALID_PROPERTY'
  | 'RATES_INVALID'
  | 'ROOMS_INVALID'
  | 'DISCOUNT_NOT_IN_RANGE'
  | 'STAY_DATE_NOT_IN_FUTURE'
  | 'ID_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TRANSIENT'
  | 'UNKNOWN';

export type ClassifiedPromotionError = {
  kind: PromotionErrorKind;
  /** Worth retrying later (network, 5xx, throttling, unknown). */
  retryable: boolean;
  message: string;
};

function upstreamStatusOf(e: unknown): number | null {
  if (!(e instanceof HttpException)) return null;
  const r = e.getResponse();
  if (!isRecord(r)) return null;
  const n = Number(r.upstreamStatus ?? r.returnCode);
  return Number.isFinite(n) ? n : null;
}

/** Map a Zodomus/Booking failure to a stable kind (Booking error codes + Zodomus messages). */
export function classifyPromotionError(e: unknown): ClassifiedPromotionError {
  const message = (
    e instanceof HttpException
      ? formatZodomusHttpException(e)
      : e instanceof Error
        ? e.message
        : String(e)
  ).slice(0, 2000);
  const t = message.toLowerCase();
  const status = upstreamStatusOf(e);
  const fail = (kind: PromotionErrorKind, retryable: boolean): ClassifiedPromotionError => ({
    kind,
    retryable,
    message,
  });

  if (t.includes('hotel_ineligible') || t.includes('ineligible'))
    return fail('HOTEL_INELIGIBLE', false);
  if (t.includes('rates_invalid') || t.includes('invalid rate'))
    return fail('RATES_INVALID', false);
  if (t.includes('rooms_invalid') || t.includes('invalid room'))
    return fail('ROOMS_INVALID', false);
  if (t.includes('discount_not_in_range')) return fail('DISCOUNT_NOT_IN_RANGE', false);
  if (t.includes('stay_date_not_in_future')) return fail('STAY_DATE_NOT_IN_FUTURE', false);
  if (t.includes('id_not_found') || t.includes('promotion not found'))
    return fail('ID_NOT_FOUND', false);
  if (t.includes('invalid property') || t.includes('invalid listing'))
    return fail('INVALID_PROPERTY', false);
  if (t.includes('property status not active') || t.includes('awaiting approval'))
    return fail('PROPERTY_NOT_ACTIVE', false);
  if (
    status === 403 ||
    t.includes('forbidden') ||
    t.includes('access denied') ||
    t.includes('hotel_access_denied') ||
    t.includes('not authorized') ||
    t.includes('authorization required')
  ) {
    return fail('ACCESS_DENIED', false);
  }
  if (
    status === 429 ||
    t.includes('too many') ||
    t.includes('rate limit') ||
    t.includes('suspended')
  ) {
    return fail('RATE_LIMITED', true);
  }
  if (
    e instanceof ServiceUnavailableException ||
    (status !== null && status >= 500) ||
    t.includes('timed out') ||
    t.includes('unreachable') ||
    t.includes('internal server error')
  ) {
    return fail('TRANSIENT', true);
  }
  return fail('UNKNOWN', true);
}
