import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';

export interface KbPendingItem {
  id: string;
  propertyId: string;
  propertyName: string;
  guestQuestion: string;
  managerAnswer: string;
  status: 'pending';
  createdAt: string;
}

export interface KbPendingPayload {
  items: KbPendingItem[];
  total: number;
  days: number;
}

export function useKbPending(days = 30, limit = 200) {
  const key = `/kb/pending?days=${days}&limit=${limit}`;
  const { data, error, isLoading, mutate } = useSWR<KbPendingPayload>(key, fetcher);

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    days: data?.days ?? days,
    isLoading,
    isError: !!error,
    mutate,
  };
}

export async function kbBulkAdd(ids: string[]): Promise<{ added: number }> {
  const res = await apiClient.post<{ data: { added: number } }>('/kb/bulk-add', { ids });
  return res.data.data;
}

export async function kbPatchPending(
  id: string,
  body: { guestQuestion: string; managerAnswer: string },
): Promise<KbPendingItem> {
  const res = await apiClient.patch<{ data: KbPendingItem }>(`/kb/${id}`, body);
  return res.data.data;
}

export async function kbIgnore(id: string): Promise<void> {
  await apiClient.delete(`/kb/${id}`);
}
