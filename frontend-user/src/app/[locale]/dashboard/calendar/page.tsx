'use client';

import { useState } from 'react';
import { CalendarView } from '@/modules/calendar/CalendarView';
import { buildCalendarWindowAround } from '@/modules/calendar/components/TimelineNavBar';
import type { CalendarDateRange, CalendarFilters } from '@/modules/calendar/types';

const DEFAULT_RANGE: CalendarDateRange = buildCalendarWindowAround(new Date());

const DEFAULT_FILTERS: CalendarFilters = {
  propertyQuery: '',
  channelFilter: 'all',
  statusFilter: 'all',
};

export default function CalendarPage() {
  const [dateRange, setDateRange] = useState<CalendarDateRange>(DEFAULT_RANGE);
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_FILTERS);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CalendarView
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </div>
  );
}
