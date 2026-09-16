/**
 * Booking.com via Zodomus often sends reservation.totalPrice = "0"
 * while the real amount is on rooms[].totalPrice (and/or rooms[].prices[].price).
 */

function toMajor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
