/**
 * Booking «targeting» rates (Mobile rate, Country rate) set up in the extranet.
 *
 * They are a different category from Basic / Last-minute / Early booker deals, so they do not compete
 * with our discounts — they stack on top of them, and on top of Genius (Partner Hub, «Setting up mobile
 * rates», checked 2026-10-08). The two targeting rates never combine with each other: the guest gets
 * the larger one. So the lowest price a guest can see = rack × Genius × our deal × largest targeting rate.
 */

import type { PricePromotionEntity } from './entities/price-promotion.entity';
import type { PricePromotionTargetEntity } from './entities/price-promotion-target.entity';

/** Booking API types: `mobile_rate`, `geo_rate` (country rate); tolerant to how the channel spells them. */
export function isTargetingRateType(type: string | null | undefined): boolean {
  return !!type && /mobile|geo|country/i.test(type);
}

type TargetLite = Pick<PricePromotionTargetEntity, 'propertyId' | 'state'> & {
  promotion?: Pick<PricePromotionEntity, 'source' | 'status' | 'promotionType' | 'discountPct'> | null;
};

/** Largest targeting rate (%) that is on at Booking right now, per property. */
export function targetingPctByProperty(targets: readonly TargetLite[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of targets) {
    const p = t.promotion;
    if (!p || t.state !== 'on' || p.source !== 'booking' || p.status !== 'active') continue;
    if (!isTargetingRateType(p.promotionType) || !(p.discountPct > 0)) continue;
    out.set(t.propertyId, Math.max(out.get(t.propertyId) ?? 0, p.discountPct));
  }
  return out;
}
