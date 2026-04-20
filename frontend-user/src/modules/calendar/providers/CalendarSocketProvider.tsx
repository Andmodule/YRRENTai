'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectCalendarSocket } from '@/lib/socket/calendar-socket';

/**
 * Keeps `/calendar` WebSocket connected for the whole dashboard session (same idea as TasksSocketProvider).
 * If the socket only lived inside CalendarView, Strict Mode / route changes could drop the connection
 * before events arrive, and other dashboard pages would miss invalidations.
 */
export function CalendarSocketProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectCalendarSocket();

    const onCalendarChanged = () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    };

    socket.on('calendar.changed', onCalendarChanged);

    return () => {
      socket.off('calendar.changed', onCalendarChanged);
      socket.disconnect();
    };
  }, [queryClient]);

  return <>{children}</>;
}
