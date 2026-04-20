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

    const invalidateCalendar = () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    };

    const onCalendarChanged = () => {
      invalidateCalendar();
    };

    /** Подхватить данные после handshake и после reconnect (WS мог пропустить emit пока отключены). */
    const onConnect = () => {
      invalidateCalendar();
    };

    socket.on('calendar.changed', onCalendarChanged);
    socket.on('connect', onConnect);

    return () => {
      socket.off('calendar.changed', onCalendarChanged);
      socket.off('connect', onConnect);
      socket.disconnect();
    };
  }, [queryClient]);

  return <>{children}</>;
}
