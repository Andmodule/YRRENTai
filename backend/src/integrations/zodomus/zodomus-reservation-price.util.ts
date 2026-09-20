/**
 * Booking.com via Zodomus often sends reservation.totalPrice = "0"
 * while the real amount is on rooms[].totalPrice (and/or rooms[].prices[].price).
 */

function toMajor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a 3-letter ISO 4217 currency code; null if missing/invalid. */
export function normalizeCurrencyCode(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * Resolve ISO currency from a Zodomus reservation (or similar) payload.
 * Prefer reservation-level codes, then rooms / nightly prices, then CRM property,
 * then an already-stored booking currency — never invent EUR/USD when a better source exists.
 */
export function resolveZodomusCurrency(
  raw: Record<string, unknown> | null | undefined,
  rooms?: unknown[] | null,
  propertyCurrency?: string | null,
  existingBookingCurrency?: string | null,
): string | null {
  const fromTop =
    normalizeCurrencyCode(raw?.currencyCode) ?? normalizeCurrencyCode(raw?.currency);
  if (fromTop) return fromTop;

  const roomList = Array.isArray(rooms) ? rooms : [];
  for (const room of roomList) {
    if (!room || typeof room !== 'object') continue;
    const r = room as Record<string, unknown>;
    const fromRoom =
      normalizeCurrencyCode(r.currencyCode) ?? normalizeCurrencyCode(r.currency);
    if (fromRoom) return fromRoom;
    const prices = r.prices;
    if (!Array.isArray(prices)) continue;
    for (const p of prices) {
      if (!p || typeof p !== 'object') continue;
      const rec = p as Record<string, unknown>;
      const fromNight =
        normalizeCurrencyCode(rec.currencyCode) ?? normalizeCurrencyCode(rec.currency);
      if (fromNight) return fromNight;
    }
  }

  return (
    normalizeCurrencyCode(propertyCurrency) ??
    normalizeCurrencyCode(existingBookingCurrency)
  );
}

/**
 * Walk GET /availability (or similar ARI) JSON for the first valid currency code.
 * Often null on Booking.com via Zodomus — callers should fall back to property.currency.
 */
export function extractCurrencyFromZodomusPayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const top =
    normalizeCurrencyCode(root.currencyCode) ?? normalizeCurrencyCode(root.currency);
  if (top) return top;

  const stack: unknown[] = [body];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    const found =
      normalizeCurrencyCode(rec.currencyCode) ?? normalizeCurrencyCode(rec.currency);
    if (found) return found;
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

function sumRoomTotals(rooms: unknown[]): number | null {
  let sum = 0;
  let found = false;
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;
    const total = toMajor((room as Record<string, unknown>).totalPrice);
    if (total != null && total > 0) {
      sum += total;
      found = true;
    }
  }
  return found ? Math.round(sum * 100) / 100 : null;
}

/** Last resort: sum nightly `prices[].price` across rooms. */
function sumRoomNightlyPrices(rooms: unknown[]): number | null {
  let sum = 0;
  let found = false;
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;
    const prices = (room as Record<string, unknown>).prices;
    if (!Array.isArray(prices)) continue;
    for (const p of prices) {
      if (!p || typeof p !== 'object') continue;
      const night = toMajor((p as Record<string, unknown>).price);
      if (night != null && night > 0) {
        sum += night;
        found = true;
      }
    }
  }
  return found ? Math.round(sum * 100) / 100 : null;
}

/**
 * Resolve stay total in major currency units.
 * Prefer reservation-level total when > 0; else rooms[].totalPrice; else nightly prices.
 */
export function resolveZodomusReservationTotalMajor(
  reservationTotal: unknown,
  rooms: unknown[] | undefined,
): number | undefined {
  const top = toMajor(reservationTotal);
  if (top != null && top > 0) return top;

  const roomList = Array.isArray(rooms) ? rooms : [];
  const fromRooms = sumRoomTotals(roomList);
  if (fromRooms != null) return fromRooms;

  const fromNights = sumRoomNightlyPrices(roomList);
  if (fromNights != null) return fromNights;

  if (top === 0) return 0;
  return undefined;
}
