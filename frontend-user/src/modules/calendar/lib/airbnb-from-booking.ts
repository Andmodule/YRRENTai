/**
 * The Airbnb price RentAI sends for a night of a connected listing that has neither its own Airbnb price nor a
 * base price: Booking's main rate minus the biggest Basic deal the property has on Booking that night
 * (Basic deals do not add up), whole złoty, never below the property minimum. Mirrors `airbnbPrice` /
 * `basicPctOn` on the server (backend/src/airbnb/airbnb-calendar.util.ts) — the cell must show what is sent.
 */
export function airbnbFromBooking(
  rack: number | null,
  promotions: readonly { promotionType: string; state: string; discountPct: number }[],
  minPrice: number | null,
): number | null {
  if (rack == null || !(rack > 0)) return null;
  let pct = 0;
  for (const p of promotions) {
    if (p.promotionType !== 'basic' || p.state !== 'on') continue;
    if (Number.isFinite(p.discountPct) && p.discountPct > pct && p.discountPct < 100) pct = p.discountPct;
  }
  const price = Math.round(rack * (1 - pct / 100));
  return minPrice != null && price < minPrice ? Math.ceil(minPrice) : price;
}
