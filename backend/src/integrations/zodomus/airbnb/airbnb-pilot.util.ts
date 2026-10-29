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

/** First non-empty string (or finite number) under any of `keys`, at the top level or in `data` / `status`. */
function pick(body: unknown, keys: readonly string[]): string | null {
  const layers: unknown[] = [body];
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    layers.push(o.data, o.status, o.result);
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

/** POST /airbnb-host-activation → `{ token, client_id }` (shape not fixed by the docs: looked up loosely). */
export function parseHostActivation(body: unknown): { token: string; clientId: string } | null {
  const token = pick(body, ['token', 'Token']);
  const clientId = pick(body, ['client_id', 'clientId', 'clientID']);
  return token && clientId ? { token, clientId } : null;
}

/** GET /airbnb-host-status → its status code (5 = «Host is active») and message. */
export function parseHostStatus(body: unknown): { code: number | null; text: string | null; active: boolean } {
  const raw = pick(body, ['statusCode', 'hostStatusCode', 'status_code']);
  const n = raw != null && /^-?\d+$/.test(raw) ? Number(raw) : null;
  const text = pick(body, ['statusMessage', 'hostStatus', 'message', 'returnMessage']);
  return { code: n, text, active: n === 5 };
}

export interface AirbnbListingView {
  id: string;
  name: string | null;
}

/** GET /airbnb-listings → the listings of the page and the cursor of the next one. */
export function parseListings(body: unknown): { listings: AirbnbListingView[]; nextCursor: string | null } {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const arr = [o.listings, o.data, (o.data as Record<string, unknown> | undefined)?.listings].find(Array.isArray) as
    | unknown[]
    | undefined;
  const listings: AirbnbListingView[] = [];
  for (const item of arr ?? []) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const id = normalizeListingId(l.id ?? l.listingId ?? l.listing_id);
    if (!id) continue;
    const name = typeof l.name === 'string' ? l.name : typeof l.title === 'string' ? l.title : null;
    listings.push({ id, name });
  }
  const cursor = pick(o, ['_cursor', 'next_cursor', 'nextCursor', 'cursor']);
  return { listings, nextCursor: cursor };
}
