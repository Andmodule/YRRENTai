'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export type DeliveryRouteListItem = {
  id: string;
  scheduledDate: string;
  status: string;
  driverUserId: string | null;
  driverName: string | null;
  warehouseLabel: string | null;
  stopsCount: number;
  createdAt: string;
};

export type DeliveryRouteDetail = {
  id: string;
  companyId: string;
  scheduledDate: string;
  status: string;
  driverUserId: string | null;
  driverName: string | null;
  warehouseLabel: string | null;
  driverCanReorderStops: boolean;
  startedAt: string | null;
  completedAt: string | null;
  pickingLines: Array<{ name: string; quantity: string; unit: string | null }>;
  stops: Array<{
    id: string;
    sortOrder: number;
    kind: string;
    propertyId: string | null;
    propertyTitle: string | null;
    propertyAddress: string | null;
    status: string;
    completedAt: string | null;
    lines: Array<{
      supplyRequestItemId: string;
      name: string;
      quantity: string | null;
      unit: string | null;
    }>;
  }>;
};

/** Корень запросов маршрутов: инвалидируйте `['…', 'list']` или `['…', 'detail', id]`, не весь корень — иначе сбрасывается открытый лист. */
export const MANAGER_DELIVERY_ROUTES_ROOT = ['tasks', 'manager-delivery-routes'] as const;

export function useDeliveryRoutesList(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'list', from ?? '', to ?? ''],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const q = params.toString();
      const res = await apiClient.get<{ data: { routes: DeliveryRouteListItem[] } }>(
        `/tasks/manager/delivery-routes${q ? `?${q}` : ''}`,
        { signal },
      );
      return res.data.data.routes;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useDeliveryRouteDetail(routeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'detail', routeId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { route: DeliveryRouteDetail } }>(
        `/tasks/manager/delivery-routes/${routeId}`,
      );
      return res.data.data.route;
    },
    enabled: enabled && !!routeId,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateDeliveryRouteFromPool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      supplyItemIds?: string[];
      requestLineIds?: string[];
      scheduledDate?: string;
      warehouseLabel?: string | null;
    }) => {
      const res = await apiClient.post<{ data: { routeId: string } }>(
        '/tasks/manager/delivery-routes/from-pool',
        body,
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useAssignDeliveryRouteDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      routeId: string;
      driverUserId: string;
      /** Смена водителя на уже начатом маршруте (форсмажор). */
      allowReassignWhileActive?: boolean;
    }) => {
      const res = await apiClient.patch<{ data: { ok: true } }>(
        `/tasks/manager/delivery-routes/${payload.routeId}/assign-driver`,
        {
          driverUserId: payload.driverUserId,
          ...(payload.allowReassignWhileActive ? { allowReassignWhileActive: true } : {}),
        },
      );
      return res.data.data;
    },
    onSuccess: (_data, payload) => {
      void queryClient.invalidateQueries({ queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'list'] });
      void queryClient.invalidateQueries({
        queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'detail', payload.routeId],
      });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useDisbandDeliveryRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (routeId: string) => {
      const res = await apiClient.post<{ data: { ok: true } }>(
        `/tasks/manager/delivery-routes/${routeId}/disband`,
      );
      return res.data.data;
    },
    onSuccess: (_data, routeId) => {
      void queryClient.invalidateQueries({ queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'list'] });
      void queryClient.removeQueries({ queryKey: [...MANAGER_DELIVERY_ROUTES_ROOT, 'detail', routeId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}
