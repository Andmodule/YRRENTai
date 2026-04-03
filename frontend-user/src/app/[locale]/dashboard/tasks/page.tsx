'use client';

import { addDays } from 'date-fns';
import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ManagerKanban } from '@/modules/tasks/components/manager/ManagerKanban';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskFilters } from '@/modules/tasks/types';

const DEFAULT_FILTERS: TaskFilters = {
  dateRange: { start: new Date(), end: addDays(new Date(), 7) },
  statusFilter: 'all',
  priorityFilter: 'all',
  assigneeId: 'all',
  propertyQuery: '',
};

function TasksBoardFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const t = useTranslations('tasks');
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{t('pageTitle')}</h1>
      <Suspense fallback={<TasksBoardFallback />}>
        <ManagerKanban filters={filters} onFiltersChange={setFilters} />
      </Suspense>
    </div>
  );
}
