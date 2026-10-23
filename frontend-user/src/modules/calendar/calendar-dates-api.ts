'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/use-auth';
import type { DatesAction, DatesRequestBody, SkipReason } from './lib/calendar-dates';

/** Mirrors backend `backend/src/calendar-dates` (`/api/v1/calendar-dates`). */

export interface CalendarDatesStatus {
  /** ZODOMUS_CALENDAR_DATES_ENABLED. */
  enabled: boolean;
  /** Nights ahead (from today) that may be opened — RentAI pushes availability only that far. */
  horizonDays?: number;
  auto: { enabled: boolean; dryRun: boolean; hourUtc: number };
}

export interface DatesRange {
  dateFrom: string;
  /** Exclusive. */
  dateToExclusive: string;
  price: number;
  closed: boolean;
  nights: number;
}

/** A run opens / closes nights, or only re-prices them («Цены → базовая цена»). */
export type DatesJobAction = DatesAction | 'price';

export interface CalendarDatesPreview {
  propertyId: string;
  propertyName: string;
  action: DatesJobAction;
  dateFrom: string;
  dateToExclusive: string;
  rate: { id: string; name: string | null };
  currency: string;
  minPrice: number | null;
  nights: number;
  changes: { open: number; close: number; price: number };
  skipped: Record<SkipReason, number>;
  requests: number;
  estimateSeconds: number;
  tooMany: boolean;
  ranges: DatesRange[];
  /** «close»: nights closed on Booking already — RentAI remembers them for auto-extension. */
  alreadyClosed: number;
}

export interface CalendarDatesJob {
  id: string;
  propertyId: string;
  source: 'manual' | 'auto';
  action: DatesJobAction;
  dateFrom: string;
  dateToExclusive: string;
  state: 'running' | 'done' | 'failed' | 'stopped';
  phase: 'sending' | 'verifying' | 'finished';
  total: number;
  sent: number;
  failed: { dateFrom: string; dateToExclusive: string; detail: string }[];
  /** Planned. */
  changes: { open: number; close: number; price: number };
  /** Accepted by Booking; null while sending. */
  applied: { open: number; close: number; price: number } | null;
  verify: { checked: number; mismatched: string[]; error?: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AutoOpenResult {
  at: string;
  dryRun: boolean;
  from: string;
  toExclusive: string;
  opened: number;
  skipped: number;
  failed: number;
  mismatched: number;
  error?: string;
}

export interface AutoOpenView {
  enabled: boolean;
  dryRun: boolean;
  hourUtc: number;
  settings: {
    enabled: boolean;
    horizonDays: number;
    /** null: only «closed by hand» nights are kept, auto-extension was never set up. */
    price: number | null;
    weekendPrice: number | null;
    openedUntil: string | null;
    keepClosed: number;
    lastRunAt: string | null;
    lastResult: AutoOpenResult | null;
  } | null;
}

export interface AutoOpenInput {
  propertyId: string;
  enabled: boolean;
  horizonDays: number;
  price: number;
  weekendPrice?: number | null;
}

type Envelope<T> = { data: { data: T } };
const unwrap = <T>(p: Promise<Envelope<T>>): Promise<T> => p.then((r) => r.data.data);

export const calendarDatesApi = {
  status: () => unwrap<CalendarDatesStatus>(apiClient.get('/calendar-dates/status')),
  preview: (body: DatesRequestBody) => unwrap<CalendarDatesPreview>(apiClient.post('/calendar-dates/preview', body)),
  apply: (body: DatesRequestBody) => unwrap<CalendarDatesJob>(apiClient.post('/calendar-dates/apply', body)),
  job: (propertyId: string) =>
    unwrap<CalendarDatesJob | null>(apiClient.get('/calendar-dates/job', { params: { propertyId } })),
  auto: {
    get: (propertyId: string) => unwrap<AutoOpenView>(apiClient.get('/calendar-dates/auto', { params: { propertyId } })),
    save: (input: AutoOpenInput) => unwrap<AutoOpenView>(apiClient.put('/calendar-dates/auto', input)),
  },
};

export const calendarDatesKeys = {
  status: ['calendar-dates', 'status'] as const,
  job: (propertyId: string) => ['calendar-dates', 'job', propertyId] as const,
  auto: (propertyId: string) => ['calendar-dates', 'auto', propertyId] as const,
};

const ROLES = new Set(['OWNER', 'MANAGER', 'SUPERADMIN']);

/** Shown only to owners / managers and only when the server has the tool switched on. */
export function useCalendarDatesAccess() {
  const { user } = useAuth();
  const canUse = !!user && ROLES.has(user.role);
  const status = useQuery({
    queryKey: calendarDatesKeys.status,
    queryFn: calendarDatesApi.status,
    enabled: canUse,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    enabled: canUse && status.data?.enabled === true,
    auto: canUse && status.data?.enabled === true && status.data.auto.enabled === true,
    autoDryRun: status.data?.auto.dryRun ?? true,
    horizonDays: status.data?.horizonDays ?? 366,
  };
}

/** The property's last run; polls while it is going. */
export function useCalendarDatesJob(propertyId: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarDatesKeys.job(propertyId),
    queryFn: () => calendarDatesApi.job(propertyId),
    enabled: enabled && !!propertyId,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 2500 : false),
  });
}

export function useAutoOpen(propertyId: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarDatesKeys.auto(propertyId),
    queryFn: () => calendarDatesApi.auto.get(propertyId),
    enabled: enabled && !!propertyId,
    retry: false,
  });
}

export function useCalendarDatesMutations() {
  const qc = useQueryClient();
  const preview = useMutation({ mutationFn: calendarDatesApi.preview });
  const apply = useMutation({
    mutationFn: calendarDatesApi.apply,
    onSuccess: (job) => qc.setQueryData(calendarDatesKeys.job(job.propertyId), job),
  });
  const saveAuto = useMutation({
    mutationFn: calendarDatesApi.auto.save,
    onSuccess: (view, input) => qc.setQueryData(calendarDatesKeys.auto(input.propertyId), view),
  });
  return { preview, apply, saveAuto };
}
