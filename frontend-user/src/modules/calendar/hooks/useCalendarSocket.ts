'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getCalendarSocket, disconnectCalendarSocket } from '@/lib/socket/calendar-socket';

/**
 * Subscribes to the backend `/calendar` WebSocket namespace.
 * On `calendar.changed` event — immediately invalidates React Query cache
 * so the calendar re-fetches without waiting for the 20s polling interval.
 */
export function useCalendarSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getCalendarSocket();

    const handleChanged = () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
    };

    socket.on('calendar.changed', handleChanged);

    return () => {
      socket.off('calendar.changed', handleChanged);
      disconnectCalendarSocket();
    };
  }, [queryClient]);
}
