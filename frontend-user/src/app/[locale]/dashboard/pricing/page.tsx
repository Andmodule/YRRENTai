'use client';

import { Suspense } from 'react';
import { PromotionsScreen } from '@/modules/pricing/components/PromotionsScreen';

export default function PricingPromotionsPage() {
  // useSearchParams (deep link ?promotion=) needs a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <PromotionsScreen />
    </Suspense>
  );
}
