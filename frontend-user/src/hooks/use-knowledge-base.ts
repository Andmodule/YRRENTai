import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';
import type { KbEntry } from '@/types';

export function useKnowledgeBase(propertyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<KbEntry[]>(
    propertyId ? `/knowledge-base/${propertyId}` : null,
    fetcher,
  );

  async function createEntry(entryData: {
    title: string;
    content: string;
    category?: string;
  }): Promise<KbEntry> {
    const res = await apiClient.post<{ data: KbEntry }>(
      `/knowledge-base/${propertyId}`,
      entryData,
    );
    await mutate();
    return res.data.data;
  }

  async function updateEntry(
    id: string,
    entryData: { title?: string; content?: string; category?: string },
  ): Promise<KbEntry> {
    const res = await apiClient.patch<{ data: KbEntry }>(
      `/knowledge-base/${propertyId}/${id}`,
      entryData,
    );
    await mutate();
    return res.data.data;
  }

  async function deleteEntry(id: string): Promise<void> {
    await apiClient.delete(`/knowledge-base/${propertyId}/${id}`);
    await mutate();
  }

  async function backfillEmbeddings(): Promise<{ queued: number }> {
    const res = await apiClient.post<{ data: { queued: number } }>(
      `/knowledge-base/${propertyId}/backfill-embeddings`,
    );
    return res.data.data;
  }

  return {
    entries: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    createEntry,
    updateEntry,
    deleteEntry,
    backfillEmbeddings,
  };
}
