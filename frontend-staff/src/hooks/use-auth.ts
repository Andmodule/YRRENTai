'use client';

import useSWR from 'swr';
import { apiClient } from '@/lib/api/client';

export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** Тип работы из панели менеджера «Персонал» (`cleaner`, `driver`, …). */
  staffJobType?: string | null;
  staffShiftCompletedAt?: string | null;
}

async function fetchMe(): Promise<StaffUser> {
  const res = await apiClient.get<{ data: StaffUser }>('/users/me');
  return res.data.data;
}

export function useAuth() {
  const { data, error, isLoading, mutate } = useSWR<StaffUser>(
    'staff-auth/me',
    fetchMe,
    { shouldRetryOnError: false, revalidateOnFocus: true },
  );

  return {
    user: data,
    error,
    isLoading,
    isStaff: data?.role === 'STAFF',
    isAuthenticated: !!data && !error,
    mutate,
  };
}
