'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import type { OtaPlatformRef } from '@rentai/shared';

export function useOtaPlatforms() {
  const { data, error, isLoading } = useSWR<OtaPlatformRef[]>('/ota-platforms', fetcher);
  return { platforms: data ?? [], isLoading, isError: !!error };
}
