'use client';

import { useState } from 'react';
import { addDays, subDays } from 'date-fns';
import { CalendarView } from '@/modules/calendar/CalendarView';
import type { CalendarDateRange, CalendarFilters } from '@/modules/calendar/types';

const DEFAULT_RANGE: CalendarDateRange = {
  start: subDays(new Date(), 3),
  end: addDays(new Date(), 18),
};

const DEFAULT_FILTERS: CalendarFilters = {
  propertyQuery: '',
  channelFilter: 'all',
  statusFilter: 'all',
};

export default function CalendarPage() {
  const [dateRange, setDateRange] = useState<CalendarDateRange>(DEFAULT_RANGE);
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_FILTERS);

  return (
    <CalendarView
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
}
