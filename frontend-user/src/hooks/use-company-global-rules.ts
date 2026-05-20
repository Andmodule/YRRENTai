import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';
import type { CompanyGlobalQaEntry } from '@rentai/shared';

export interface CompanyGlobalRules {
  globalDescription: string | null;
  globalRules: string | null;
  globalQaEntries: CompanyGlobalQaEntry[];
  updatedAt: string | null;
}

export function useCompanyGlobalRules() {
  const { data, error, isLoading, mutate } = useSWR<CompanyGlobalRules>(
    '/company/global-rules',
    fetcher,
  );

  async function updateRules(body: {
    globalDescription?: string | null;
    globalRules?: string | null;
    globalQaEntries?: CompanyGlobalQaEntry[];
  }): Promise<CompanyGlobalRules> {
    const res = await apiClient.patch<{ data: CompanyGlobalRules }>(
      '/company/global-rules',
      body,
    );
    await mutate();
    return res.data.data;
  }

  return {
    rules: data ?? {
      globalDescription: null,
      globalRules: null,
      globalQaEntries: [],
      updatedAt: null,
    },
    isLoading,
    isError: !!error,
    mutate,
    updateRules,
  };
}
