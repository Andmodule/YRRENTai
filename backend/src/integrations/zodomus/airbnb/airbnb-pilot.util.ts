/**
 * Airbnb through Zodomus — the pilot is ONE listing (owner's decision 2026-10-22: «работаем ИСКЛЮЧИТЕЛЬНО
 * С 1 обектом — другие не трогать»). Every write to Airbnb checks `assertAirbnbPilotListing` before it is
 * sent; other listings of the host are never written to and are not shown beyond a count.
 */
import { ForbiddenException } from '@nestjs/common';

/** K22 Andersa 12 m Ratusz Arsenal on Airbnb. Ids are kept as strings (Airbnb moves to strings ≤ 128 chars). */
export const AIRBNB_PILOT_LISTING_IDS: readonly string[] = ['1017407411799040875'];

/** Zodomus channel id of Airbnb. */
export const AIRBNB_CHANNEL_ID = 3;

/** Where Airbnb sends the host back after «Allow» (fixed by Zodomus). */
export const AIRBNB_REDIRECT_URI = 'https://api.zodomus.com/airbnb-webhook-redirect';

/** A listing id as Airbnb / Zodomus may send it (number or string, maybe with spaces) → trimmed string. */
export function normalizeListingId(id: unknown): string {
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return typeof id === 'string' ? id.trim() : '';
}

export function isAirbnbPilotListing(id: unknown): boolean {
  const s = normalizeListingId(id);
  return s !== '' && AIRBNB_PILOT_LISTING_IDS.includes(s);
}

/** Refuses any listing but the pilot one — call before every request that writes to Airbnb. */
export function assertAirbnbPilotListing(id: unknown): string {
  const s = normalizeListingId(id);
  if (!isAirbnbPilotListing(s)) {
    throw new ForbiddenException(`Airbnb: объявление ${s || '(пусто)'} не в пилоте — запись запрещена`);
  }
  return s;
}

/** The page where the host allows Zodomus on Airbnb (scope: property management only, no messages). */
export function airbnbAuthUrl(clientId: string, token: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: AIRBNB_REDIRECT_URI,
    scope: 'property_management',
    state: token,
  });
  return `https://www.airbnb.com/oauth2/auth?${q.toString()}`;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * First non-empty string (or finite number) under any of `keys`: at the top level or in `host` / `response`
 * (where Zodomus puts Airbnb answers), `data` / `status` / `result`, or `response.paging`.
 */
function pick(body: unknown, keys: readonly string[]): string | null {
  const layers: unknown[] = [body];
  const o = obj(body);
  if (o) {
    layers.push(o.host, o.response, o.data, o.status, o.result, obj(o.response)?.paging);
  }
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    const o = layer as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

/**
 * POST /airbnb-host-activation → `{ status, token: 9851359133, client_id: "…" }` (Zodomus docs; the token
 * comes as a number — kept as a string).
 */
export function parseHostActivation(body: unknown): { token: string; clientId: string } | null {
  const token = pick(body, ['token', 'Token']);
  const clientId = pick(body, ['client_id', 'clientId', 'clientID']);
  return token && clientId ? { token, clientId } : null;
}

/** GET /airbnb-host-status → `{ status, host: { statusCode: "5", statusMessage: "Host is active" } }`. */
export function parseHostStatus(body: unknown): { code: number | null; text: string | null; active: boolean } {
  const o = obj(body);
  // Only the host's own status: `status.returnMessage` is the API call's, not the host's.
  const host = obj(o?.host) ?? obj(obj(o?.response)?.host) ?? null;
  const raw = host ? pick(host, ['statusCode']) : null;
  const n = raw != null && /^-?\d+$/.test(raw) ? Number(raw) : null;
  const text = host ? pick(host, ['statusMessage']) : null;
  return { code: n, text, active: n === 5 };
}

export interface AirbnbListingView {
  id: string;
  name: string | null;
}

/**
 * GET /airbnb-listings → `{ response: { listings: [{ id, idStr, name, … }], paging: { nextCursor } } }`.
 * The id is taken from `idStr`: `id` is a 64-bit number that JSON.parse rounds (1017407411799040875 would
 * come back as …900) — a numeric `id` is used only when it is a safe integer.
 */
export function parseListings(body: unknown): { listings: AirbnbListingView[]; nextCursor: string | null } {
  const o = obj(body) ?? {};
  const response = obj(o.response);
  const arr = [response?.listings, o.listings, o.data, obj(o.data)?.listings].find(Array.isArray) as unknown[] | undefined;
  const listings: AirbnbListingView[] = [];
  for (const item of arr ?? []) {
    const l = obj(item);
    if (!l) continue;
    const str = normalizeListingId(l.idStr ?? l.listingIdStr);
    const num = l.id ?? l.listingId ?? l.listing_id;
    const id = str || (typeof num === 'string' || (typeof num === 'number' && Number.isSafeInteger(num)) ? normalizeListingId(num) : '');
    if (!id) continue;
    const name = typeof l.name === 'string' ? l.name : typeof l.title === 'string' ? l.title : null;
    listings.push({ id, name });
  }
  const paging = obj(response?.paging);
  const cursor = (paging ? pick(paging, ['nextCursor']) : null) ?? pick(o, ['_cursor', 'next_cursor', 'nextCursor']);
  return { listings, nextCursor: cursor };
}

/**
 * A POST through the generic «Zodomus API» page that would write to Airbnb: an `/airbnb-…` path (host
 * activation / cancellation, listings, calendar…) or anything sent for channel 3 (property-activation,
 * availability, rates). Those go only through src/airbnb, which checks the pilot listing.
 */
export function isAirbnbWrite(path: string, channelId: unknown, body: Record<string, unknown>): boolean {
  const p = String(path ?? '').trim().toLowerCase().replace(/^\/+/, '');
  if (p.startsWith('airbnb')) return true;
  const isAirbnb = (v: unknown) => v === AIRBNB_CHANNEL_ID || (typeof v === 'string' && v.trim() === String(AIRBNB_CHANNEL_ID));
  return isAirbnb(channelId) || isAirbnb(body.channelId);
}

/** POST paths RentAI may send for Airbnb at all; everything else for Airbnb is refused in the client. */
const AIRBNB_POST_PATHS = new Set(['airbnb-host-activation', 'property-activation', 'airbnb-calendar']);

/**
 * The last guard, in ZodomusClient.post — before anything leaves RentAI: a POST that concerns Airbnb (an
 * `/airbnb-…` path or `channelId` 3 in the body) must be one of AIRBNB_POST_PATHS and, except the host
 * activation (empty body), carry the pilot listing as `propertyId`. Booking calls pass untouched.
 */
export function assertAirbnbPostAllowed(path: string, body: unknown): void {
  const p = String(path ?? '').trim().toLowerCase().replace(/^\/+/, '').split('?')[0]!;
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const ch = b.channelId;
  const forAirbnb =
    p.startsWith('airbnb') || ch === AIRBNB_CHANNEL_ID || (typeof ch === 'string' && ch.trim() === String(AIRBNB_CHANNEL_ID));
  if (!forAirbnb) return;
  if (!AIRBNB_POST_PATHS.has(p)) {
    throw new ForbiddenException(`Airbnb: POST /${p} RentAI не отправляет`);
  }
  if (p === 'airbnb-host-activation') return;
  assertAirbnbPilotListing(b.propertyId);
  // Activating again (a generic «bind mapping» or admin call: no host token, Booking's price model) would
  // reset the listing's prices and availability on Airbnb: only RentAI's own Airbnb activation goes.
  if (p === 'property-activation') {
    const token = b.token;
    const hasToken = (typeof token === 'string' && token.trim() !== '') || (typeof token === 'number' && Number.isFinite(token));
    if (!hasToken || String(b.priceModelId) !== '4') {
      throw new ForbiddenException('Airbnb: подключение объявления — только через «Подключение Airbnb» (токен хозяина, priceModelId 4)');
    }
  }
}

/**
 * The listing id of an Airbnb webhook body. The body is already parsed: a 64-bit id sent as a JSON number
 * arrives rounded (1017407411799040875 → 1017407411799040900), so an unsafe number is matched back to the
 * pilot listing it rounds to; otherwise it is kept as sent.
 */
export function airbnbWebhookListingId(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && !Number.isSafeInteger(raw)) {
    const hit = AIRBNB_PILOT_LISTING_IDS.find((id) => Number(id) === raw);
    if (hit) return hit;
  }
  return normalizeListingId(raw);
}
