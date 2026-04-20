import type { Property, Reservation } from './types';

export function normalizeCalendarQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Совпадение с текстом поиска по полям брони (имя, email, id). */
export function reservationMatchesQuery(r: Reservation, q: string): boolean {
  if (!q) return false;
  const name = (r.guestName ?? '').toLowerCase();
  if (name.includes(q)) return true;
  if (r.guestEmail?.toLowerCase().includes(q)) return true;
  if (r.guestPhone?.toLowerCase().includes(q)) return true;
  if (r.notes?.toLowerCase().includes(q)) return true;
  if (r.internalNotes?.toLowerCase().includes(q)) return true;
  if (r.externalId.toLowerCase().includes(q)) return true;
  if (r.uuid.toLowerCase().includes(q)) return true;
  const qCompact = q.replace(/-/g, '');
  if (qCompact.length > 0) {
    const uuidCompact = r.uuid.replace(/-/g, '').toLowerCase();
    if (uuidCompact.includes(qCompact)) return true;
  }
  return false;
}

/** Объекты, у которых название совпадает с запросом или есть бронь (имя, email, номер). */
/** True when the query pinpoints this booking by UUID or full external reservation id (for autopan + modal). */
export function isBookingIdPinQuery(raw: string, hit: Reservation): boolean {
  const q = raw.trim();
  if (!q) return false;
  const ql = q.toLowerCase();
  if (hit.uuid.toLowerCase() === ql) return true;
  if (hit.externalId.toLowerCase() === ql) return true;
  const strip = (s: string) => s.replace(/-/g, '').toLowerCase();
  const qCompact = strip(q);
  if (qCompact.length === 32 && /^[0-9a-f]{32}$/i.test(qCompact) && strip(hit.uuid) === qCompact) return true;
  return false;
}

export function filterPropertiesBySearch(
  properties: Property[],
  reservations: Reservation[],
  propertyQuery: string,
): Property[] {
  const q = normalizeCalendarQuery(propertyQuery);
  if (!q) return properties;
  return properties.filter((p) => {
    if (p.title.toLowerCase().includes(q)) return true;
    return reservations.some((r) => r.propertyId === p.uuid && reservationMatchesQuery(r, q));
  });
}
