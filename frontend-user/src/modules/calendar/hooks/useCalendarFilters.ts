'use client';

import { useMemo } from 'react';
import { filterPropertiesBySearch, normalizeCalendarQuery, reservationMatchesQuery } from '../calendarSearch';
import type { CalendarFilters, Property, Reservation } from '../types';

export function useCalendarFilters(
  properties: Property[],
  reservations: Reservation[],
  filters: CalendarFilters,
  /** Matches outside the visible date window — unioned for property/search logic only, not for Planby rows. */
  globalSearchReservations: Reservation[] = [],
) {
  const reservationsForPropertySearch = useMemo(() => {
    if (globalSearchReservations.length === 0) return reservations;
    const byId = new Map(reservations.map((r) => [r.uuid, r]));
    for (const r of globalSearchReservations) {
      byId.set(r.uuid, r);
    }
    return [...byId.values()];
  }, [reservations, globalSearchReservations]);

  const filteredProperties = useMemo(
    () => filterPropertiesBySearch(properties, reservationsForPropertySearch, filters.propertyQuery),
    [properties, reservationsForPropertySearch, filters.propertyQuery],
  );

  const titleMatchedPropertyIds = useMemo(() => {
    const q = normalizeCalendarQuery(filters.propertyQuery);
    if (!q) return new Set<string>();
    return new Set(
      properties.filter((p) => p.title.toLowerCase().includes(q)).map((p) => p.uuid),
    );
  }, [properties, filters.propertyQuery]);

  const filteredPropertyIds = useMemo(
    () => new Set(filteredProperties.map((p) => p.uuid)),
    [filteredProperties],
  );

  const filteredReservations = useMemo(() => {
    const q = normalizeCalendarQuery(filters.propertyQuery);
    return reservations.filter((r) => {
      const propertyOk = filteredPropertyIds.has(r.propertyId);
      if (!propertyOk) return false;
      if (!q) {
        const channelOk = filters.channelFilter === 'all' || r.channel === filters.channelFilter;
        const statusOk = filters.statusFilter === 'all' || r.status === filters.statusFilter;
        return channelOk && statusOk;
      }
      // Поиск по брони: только совпадающие строки, не все брони объекта
      if (reservationMatchesQuery(r, q)) return true;
      // Поиск по названию объекта: показать все брони объекта (с учётом фильтров канала/статуса)
      if (titleMatchedPropertyIds.has(r.propertyId)) {
        const channelOk = filters.channelFilter === 'all' || r.channel === filters.channelFilter;
        const statusOk = filters.statusFilter === 'all' || r.status === filters.statusFilter;
        return channelOk && statusOk;
      }
      return false;
    });
  }, [
    reservations,
    filters.channelFilter,
    filters.statusFilter,
    filters.propertyQuery,
    filteredPropertyIds,
    titleMatchedPropertyIds,
  ]);

  return {
    filteredProperties,
    filteredReservations,
    reservationsForSearchIndex: reservationsForPropertySearch,
  };
}
