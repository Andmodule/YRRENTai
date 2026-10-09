'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import {
  pricingApi,
  type OccupancySettingsInput,
  type PromotionDetail,
  type PromotionInput,
  type RuleInput,
  type SettingsItem,
} from './api';

export const pricingKeys = {
  all: ['pricing'] as const,
  status: ['pricing', 'status'] as const,
  list: (propertyId?: string) => ['pricing', 'promotions', propertyId ?? 'all'] as const,
  detail: (id: string) => ['pricing', 'promotion', id] as const,
  properties: ['pricing', 'properties'] as const,
  priceToday: (propertyId: string) => ['pricing', 'price-today', propertyId] as const,
  calendar: (from: string, to: string) => ['pricing', 'calendar', from, to] as const,
  rules: ['pricing', 'rules'] as const,
  occupancy: ['pricing', 'occupancy'] as const,
};

const MANAGER_ROLES = new Set(['OWNER', 'MANAGER']);

/** «Цены» is shown only to owners/managers and only when the backend has the feature switched on. */
export function usePricingAccess() {
  const { user } = useAuth();
  const canManage = !!user && MANAGER_ROLES.has(user.role);
  const status = useQuery({
    queryKey: pricingKeys.status,
    queryFn: pricingApi.status,
    enabled: canManage,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    canManage,
    enabled: canManage && status.data?.enabled === true,
    dryRun: status.data?.dryRun ?? true,
    pilot: status.data?.pilot ?? false,
    /** «Автоправила» tab: needs the promotions feature and its own switch on the server. */
    autoRules: canManage && status.data?.enabled === true && status.data?.autoRules === true,
    occupancy: canManage && status.data?.enabled === true && status.data?.occupancy === true,
    isLoading: canManage && status.isLoading,
  };
}

/** Auto rules; refreshes quickly while Booking is still being updated. */
export function useRules(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.rules,
    queryFn: pricingApi.rules.list,
    enabled,
    refetchInterval: (q) => (q.state.data?.some((r) => r.counts.pending > 0) ? 4000 : 60_000),
  });
}

export function usePromotions(enabled: boolean, propertyId?: string) {
  return useQuery({
    queryKey: pricingKeys.list(propertyId),
    queryFn: () => pricingApi.list(propertyId),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((p) => p.counts.pending > 0) ? 4000 : 60_000),
  });
}

/** Detail; polls while Booking is still being updated. */
export function usePromotion(id: string | null) {
  return useQuery({
    queryKey: pricingKeys.detail(id ?? ''),
    queryFn: () => pricingApi.get(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && q.state.data.counts.pending > 0 ? 2500 : false),
  });
}

export function usePricingProperties(enabled: boolean) {
  return useQuery({ queryKey: pricingKeys.properties, queryFn: pricingApi.properties, enabled });
}

/** Booking price today (server caches 10 min) — read-only. */
export function usePriceToday(propertyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.priceToday(propertyId ?? ''),
    queryFn: () => pricingApi.priceToday(propertyId!),
    enabled: enabled && !!propertyId,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useCalendarPromotions(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.calendar(from, to),
    queryFn: () => pricingApi.calendar(from, to),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePricingMutations() {
  const qc = useQueryClient();
  const refresh = (detail?: PromotionDetail) => {
    if (detail) qc.setQueryData(pricingKeys.detail(detail.id), detail);
    // Not awaited: the sheet moves to «progress» as soon as the server answers. Booking prices
    // (each one is a Zodomus call on the server) and the form preview don't change — keep them.
    void qc.invalidateQueries({
      queryKey: pricingKeys.all,
      predicate: (q) => q.queryKey[1] !== 'price-today' && q.queryKey[1] !== 'preview',
    });
  };
  const create = useMutation({ mutationFn: (input: PromotionInput) => pricingApi.create(input), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PromotionInput> }) => pricingApi.update(id, input),
    onSuccess: refresh,
  });
  const setActive = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => pricingApi.setActive(id, on),
    onSuccess: refresh,
  });
  const targetAction = useMutation({
    mutationFn: ({ id, propertyId, action }: { id: string; propertyId: string; action: 'activate' | 'deactivate' | 'retry' }) =>
      pricingApi.targetAction(id, propertyId, action),
    onSuccess: refresh,
  });
  const saveSettings = useMutation({
    mutationFn: (items: SettingsItem[]) => pricingApi.updateSettings(items),
    onSuccess: (rows) => {
      qc.setQueryData(pricingKeys.properties, rows);
    },
  });
  const accessCheck = useMutation({ mutationFn: (ids?: string[]) => pricingApi.accessCheck(ids) });
  return { create, update, setActive, targetAction, saveSettings, accessCheck };
}

/** «Заполненность»: thresholds + a suggestion per property. Counted on the server from bookings. */
export function useOccupancy(enabled: boolean) {
  return useQuery({
    queryKey: pricingKeys.occupancy,
    queryFn: pricingApi.occupancy.get,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useOccupancyMutations() {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (input: OccupancySettingsInput) => pricingApi.occupancy.saveSettings(input),
    onSuccess: (overview) => qc.setQueryData(pricingKeys.occupancy, overview),
  });
  return { save };
}

export function useRulesMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: pricingKeys.all,
      predicate: (q) => q.queryKey[1] !== 'price-today' && q.queryKey[1] !== 'preview',
    });
  };
  const create = useMutation({ mutationFn: (input: RuleInput) => pricingApi.rules.create(input), onSuccess: refresh });
  const setActive = useMutation({
    mutationFn: ({ groupId, on }: { groupId: string; on: boolean }) => pricingApi.rules.setActive(groupId, on),
    onSuccess: refresh,
  });
  const setPropertyActive = useMutation({
    mutationFn: ({ groupId, propertyId, on }: { groupId: string; propertyId: string; on: boolean }) =>
      pricingApi.rules.setPropertyActive(groupId, propertyId, on),
    onSuccess: refresh,
  });
  const resend = useMutation({ mutationFn: (groupId: string) => pricingApi.rules.resend(groupId), onSuccess: refresh });
  return { create, setActive, setPropertyActive, resend };
}
