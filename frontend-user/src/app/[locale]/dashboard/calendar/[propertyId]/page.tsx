'use client';

import { Suspense, use } from 'react';
import { PropertyMonthView } from '@/modules/calendar/property-month/PropertyMonthView';

export default function PropertyCalendarPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = use(params);
  // useSearchParams (?month=) needs a Suspense boundary in Next 15.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Suspense fallback={null}>
        <PropertyMonthView propertyId={propertyId} />
      </Suspense>
    </div>
  );
}
