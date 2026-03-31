'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function CalendarSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="mb-2 h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
