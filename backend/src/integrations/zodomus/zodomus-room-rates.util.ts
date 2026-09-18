/**
 * Helpers for GET /room-rates payloads (rooms + nested rates).
 * Shared by mapping activation and calendar POST /rates push.
 */

export type ZodomusRoomRatesRoom = {
  roomId: string;
  roomName: string;
  quantity: number;
  rates: string[];
};

function pickRatesForRoom(ratesRaw: unknown[]): string[] {
  const objs = ratesRaw.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>;
  const nonChild = objs.filter((x) => !x.isChildRate);
  const standard = nonChild.filter((x) =>
    String(x.name ?? x.rateName ?? '')
      .toLowerCase()
      .includes('standard'),
  );
  const pool = standard.length > 0 ? standard : nonChild.length > 0 ? nonChild : objs;
  const ids = pool
    .map((x) => String(x.id ?? x.rateId ?? '').trim())
    .filter(Boolean);
  if (ids.length > 0) return ids;
  return ratesRaw.map((x) => String(x).trim()).filter((s) => s && s !== '[object Object]');
}

export function extractRoomsFromRoomRatesBody(
  ratesBody: unknown,
  preferRoomId?: string | null,
): ZodomusRoomRatesRoom[] {
  const root = ratesBody && typeof ratesBody === 'object' ? (ratesBody as Record<string, unknown>) : {};
  const roomsRaw = Array.isArray(root.rooms)
    ? root.rooms
    : Array.isArray((root.data as Record<string, unknown> | undefined)?.rooms)
      ? ((root.data as Record<string, unknown>).rooms as unknown[])
      : [];

  let rooms = (roomsRaw as unknown[])
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const rec = r as Record<string, unknown>;
      const roomId = String(rec.id ?? rec.roomId ?? '').trim();
      const ratesArr = Array.isArray(rec.rates) ? rec.rates : [];
      return {
        roomId,
        roomName: String(rec.name ?? rec.roomName ?? 'Room'),
        quantity: Number(rec.quantity ?? 1) || 1,
        rates: pickRatesForRoom(ratesArr),
      } satisfies ZodomusRoomRatesRoom;
    })
    .filter((r) => r.roomId && r.rates.length > 0);

  const prefer = preferRoomId?.trim();
  if (prefer) {
    const matched = rooms.filter((r) => r.roomId === prefer);
    if (matched.length > 0) rooms = matched;
  }
  return rooms;
}

/** Prefer Standard rate, else first non-child rate id for the room. */
export function pickPrimaryRateId(ratesBody: unknown, preferRoomId?: string | null): string | null {
  const rooms = extractRoomsFromRoomRatesBody(ratesBody, preferRoomId);
  const first = rooms[0];
  return first?.rates[0] ?? null;
}
