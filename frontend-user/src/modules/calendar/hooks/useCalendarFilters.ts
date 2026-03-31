'use client';

import { useMemo } from 'react';
import type { CalendarFilters, Property, Reservation } from '../types';

export function useCalendarFilters(
  properties: Property[],
  reservations: Reservation[],
  filters: CalendarFilters,
) {
  const filteredProperties = useMemo(
    () =>
      properties.filter((p) => p.title.toLowerCase().includes(filters.propertyQuery.toLowerCase().trim())),
    [properties, filters.propertyQuery],
  );

  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      const channelOk = filters.channelFilter === 'all' || r.channel === filters.channelFilter;
      const statusOk = filters.statusFilter === 'all' || r.status === filters.statusFilter;
      const propertyOk = filteredProperties.some((p) => p.uuid === r.propertyId);
      return channelOk && statusOk && propertyOk;
    });
  }, [reservations, filters.channelFilter, filters.statusFilter, filteredProperties]);

  return { filteredProperties, filteredReservations };
}
