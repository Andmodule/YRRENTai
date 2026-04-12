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
    lines: Array<{
      supplyRequestItemId: string;
      name: string;
      quantity: string | null;
      unit: string | null;
    }>;
  }>;
};

const routesKey = ['tasks', 'manager-delivery-routes'] as const;

export function useDeliveryRoutesList(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: [...routesKey, from ?? '', to ?? ''],
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
    queryKey: [...routesKey, 'detail', routeId],
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
      void queryClient.invalidateQueries({ queryKey: routesKey });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}

export function useAssignDeliveryRouteDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { routeId: string; driverUserId: string }) => {
      const res = await apiClient.patch<{ data: { ok: true } }>(
        `/tasks/manager/delivery-routes/${payload.routeId}/assign-driver`,
        { driverUserId: payload.driverUserId },
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: routesKey });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-interpretations'] });
    },
  });
}
