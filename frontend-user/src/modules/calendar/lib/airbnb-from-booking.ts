/**
 * The Airbnb price RentAI sends for a night of a connected listing that has neither its own Airbnb price nor a
 * base price: Booking's main rate minus the biggest Basic deal the property has on Booking that night
 * (Basic deals do not add up), whole złoty, never below the property minimum. Mirrors `airbnbPrice` /
 * `basicPctOn` on the server (backend/src/airbnb/airbnb-calendar.util.ts) — the cell must show what is sent.
 */
export function airbnbFromBooking(
  rack: number | null,
  promotions: readonly { promotionType: string; state: string; discountPct: number; publicDeal?: boolean }[],
  minPrice: number | null,
): number | null {
  if (rack == null || !(rack > 0)) return null;
  let pct = 0;
  for (const p of promotions) {
    // A deal for members / the app / a country only is not what a regular guest gets — the server skips it too.
    if (p.promotionType !== 'basic' || p.state !== 'on' || p.publicDeal === false) continue;
    if (Number.isFinite(p.discountPct) && p.discountPct > pct && p.discountPct < 100) pct = p.discountPct;
  }
  return wholeAboveMin(rack * (1 - pct / 100), minPrice);
}

/** As the server sends an Airbnb price: whole złoty, never below the minimum (`airbnbPrice`, `ownAirbnbPrices`). */
export function wholeAboveMin(price: number, minPrice: number | null): number {
  const p = Math.round(price);
  return minPrice != null && p < minPrice ? Math.ceil(minPrice) : p;
}
