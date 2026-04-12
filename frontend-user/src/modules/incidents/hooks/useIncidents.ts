'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface IncidentRelatedTask {
  uuid: string;
  title: string;
  status: string;
  type: string;
  assigneeName: string | null;
}

export interface IncidentSuggestedTaskDraft {
  title?: string;
  type?: 'checkout_cleaning' | 'mid_stay_cleaning' | 'checkin_prep' | 'maintenance' | 'other';
  priority?: 'normal' | 'urgent' | 'critical';
  assigneeId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface Incident {
  uuid: string;
  type: 'lost_item' | 'damage' | 'rule_violation' | 'emergency' | 'task_report';
  status:
    | 'awaiting_dispatch'
    | 'assigned'
    | 'open'
    | 'in_review'
    | 'resolved'
    | 'closed';
  propertyId: string;
  propertyTitle: string;
  /** When API sends address without title match. */
  propertyAddress?: string | null;
  /** Staff user id who reported (when available). */
  reportedBy?: string;
  reporterName?: string;
  reservationId?: string | null;
  taskId: string | null;
  description: string;
  photoUrls: string[];
  guestName: string | null;
  itemDescription: string | null;
  damageLocation: string | null;
  estimatedCost: string | null;
  managerNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** Latest non-cancelled stay for this property (by checkout). */
  lastStayGuestName?: string | null;
  lastStayGuestPhone?: string | null;
  lastStayCheckOut?: string | null;
  lastStayBookingId?: string | null;
  lastStayPaymentStatus?: 'unpaid' | 'partial' | 'paid' | null;
  relatedTasks?: IncidentRelatedTask[];
  dispatchedTaskId: string | null;
  dispatchedAssigneeId?: string | null;
  dispatchedAssigneeName?: string | null;
  suggestedTaskDraft?: IncidentSuggestedTaskDraft | null;
}

export function useIncidents(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['incidents'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { incidents: Incident[] } }>('/incidents');
      return res.data.data.incidents;
    },
    enabled: options?.enabled ?? true,
    /** Avoid empty board while refetching after PATCH (invalidate). */
    placeholderData: (previousData) => previousData,
    /** Fallback when realtime socket misses an event (e.g. mobile / flaky WS). */
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useOpenIncidentsCount() {
  return useQuery({
    queryKey: ['incidents-open-count'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { count: number } }>('/incidents/open-count');
      return res.data.data.count;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function usePatchIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      uuid,
      ...patch
    }: {
      uuid: string;
      status?: Incident['status'];
      managerNote?: string | null;
      estimatedCost?: string | null;
      appendPhotoUrls?: string[];
    }) => {
      const res = await apiClient.patch<{ data: { incident: Incident } }>(`/incidents/${uuid}`, patch);
      return res.data.data.incident;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Incident[]>(['incidents'], (old) => {
        if (!old?.length) return old;
        const idx = old.findIndex((i) => i.uuid === updated.uuid);
        if (idx === -1) return old;
        const next = [...old];
        next[idx] = updated;
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDispatchIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uuid, assigneeId }: { uuid: string; assigneeId: string }) => {
      const res = await apiClient.post<{ data: { incident: Incident } }>(`/incidents/${uuid}/dispatch`, {
        assigneeId,
      });
      return res.data.data.incident;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Incident[]>(['incidents'], (old) => {
        if (!old?.length) return old;
        const idx = old.findIndex((i) => i.uuid === updated.uuid);
        if (idx === -1) return old;
        const next = [...old];
        next[idx] = updated;
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
