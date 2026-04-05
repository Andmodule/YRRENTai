'use client';

import useSWR from 'swr';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { isAuthPath } from '@/lib/auth/locale-from-path';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  language: string;
  telegramChatId: string | null;
  companyId?: string | null;
  companyName?: string | null;
  staffJobType?: string | null;
  telegramUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchMe(): Promise<AuthUser> {
  const res = await apiClient.get<{ data: AuthUser }>('/users/me');
  return res.data.data;
}

export function useAuth() {
  const pathname = usePathname() ?? '';
  const skip = isAuthPath(pathname);

  const { data, error, isLoading, mutate } = useSWR<AuthUser>(
    skip ? null : 'auth/me',
    fetchMe,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: true,
    },
  );

  return {
    user: data,
    error,
    isLoading,
    isAuthenticated: !!data && !error,
    mutate,
  };
}
