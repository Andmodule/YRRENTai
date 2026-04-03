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
