'use client';

import { useMemo } from 'react';
import { filterPropertiesBySearch, normalizeCalendarQuery, reservationMatchesQuery } from '../calendarSearch';
import type { CalendarFilters, Property, Reservation } from '../types';

export function useCalendarFilters(
  properties: Property[],
  reservations: Reservation[],
  filters: CalendarFilters,
) {
  const filteredProperties = useMemo(
    () => filterPropertiesBySearch(properties, reservations, filters.propertyQuery),
    [properties, reservations, filters.propertyQuery],
  );

  const filteredReservations = useMemo(() => {
    const q = normalizeCalendarQuery(filters.propertyQuery);
    return reservations.filter((r) => {
      const propertyOk = filteredProperties.some((p) => p.uuid === r.propertyId);
      if (!propertyOk) return false;
      // Поиск по имени/email/номеру: показать бронь даже если не совпадает фильтр канала/статуса
      if (q && reservationMatchesQuery(r, q)) return true;
      const channelOk = filters.channelFilter === 'all' || r.channel === filters.channelFilter;
      const statusOk = filters.statusFilter === 'all' || r.status === filters.statusFilter;
      return channelOk && statusOk;
    });
  }, [
    reservations,
    filters.channelFilter,
    filters.statusFilter,
    filters.propertyQuery,
    filteredProperties,
  ]);

  return { filteredProperties, filteredReservations };
}
