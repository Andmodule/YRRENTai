'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export type StaffDeliveryRouteDetail = {
  id: string;
  scheduledDate: string;
  status: string;
  driverUserId: string | null;
  warehouseLabel: string | null;
  driverCanReorderStops: boolean;
  /** Следующая точка-объект, выбранная водителем после склада */
  driverNextStopId: string | null;
  pickingLines: Array<{ name: string; quantity: string; unit: string | null }>;
  stops: Array<{
    id: string;
    sortOrder: number;
    kind: string;
    propertyId: string | null;
    propertyTitle: string | null;
    propertyAddress: string | null;
    status: string;
    lines: Array<{
      supplyRequestItemId?: string;
      name: string;
      quantity: string | null;
      unit: string | null;
    }>;
  }>;
};

const key = ['tasks', 'staff-delivery-routes'] as const;

/** Все назначенные / активные маршруты водителя (несколько за день — все в списке). */
export function useStaffDeliveryRoutesList(enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<{ data: { routes: StaffDeliveryRouteDetail[] } }>(
        '/tasks/staff/delivery-routes',
        { signal },
      );
      return res.data.data.routes;
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** Совместимость: только первый маршрут (как старый active). */
export function useStaffDeliveryRouteActive(enabled = true) {
  const q = useStaffDeliveryRoutesList(enabled);
  return {
    ...q,
    data: q.data?.[0] ?? null,
  };
}

export function useStartDeliveryRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (routeId: string) => {
      await apiClient.post(`/tasks/delivery-routes/${routeId}/start`, {});
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useArriveStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stopId: string) => {
      await apiClient.post(`/tasks/delivery-routes/stops/${stopId}/arrive`, {});
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useCompleteStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stopId: string) => {
      await apiClient.post(`/tasks/delivery-routes/stops/${stopId}/complete`, {});
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useSetDriverNextStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { routeId: string; stopId: string }) => {
      await apiClient.post(`/tasks/delivery-routes/${payload.routeId}/next-stop`, {
        stopId: payload.stopId,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useReorderDeliveryStops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { routeId: string; orderedPropertyStopIds: string[] }) => {
      await apiClient.patch(`/tasks/manager/delivery-routes/${payload.routeId}/stops/reorder`, {
        orderedPropertyStopIds: payload.orderedPropertyStopIds,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
