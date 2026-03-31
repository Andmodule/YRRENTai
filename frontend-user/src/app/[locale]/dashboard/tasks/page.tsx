'use client';

import { addDays } from 'date-fns';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ManagerKanban } from '@/modules/tasks/components/manager/ManagerKanban';
import type { TaskFilters } from '@/modules/tasks/types';

const DEFAULT_FILTERS: TaskFilters = {
  dateRange: { start: new Date(), end: addDays(new Date(), 7) },
  statusFilter: 'all',
  priorityFilter: 'all',
  assigneeId: 'all',
  propertyQuery: '',
};

export default function TasksPage() {
  const t = useTranslations('tasks');
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{t('pageTitle')}</h1>
      <ManagerKanban filters={filters} onFiltersChange={setFilters} />
    </div>
  );
}
