'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { StaffChecklist } from '@/components/tasks/checklist';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import { LogOut } from 'lucide-react';

export default function TasksPage() {
  const { user, isLoading, isAuthenticated, isStaff } = useAuth();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      await globalMutate('staff-auth/me', undefined, { revalidate: false });
      router.replace('/login');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="staff-card flex max-w-sm flex-col items-center px-8 py-10">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-2xl shadow-inner">
            🚫
          </div>
          <p className="text-lg font-semibold text-slate-900">Доступ закрыт</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Этот вход только для персонала.
            <br />
            Вы вошли как <strong className="text-slate-800">{user?.email}</strong> ({user?.role}).
          </p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => void handleLogout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Выйти
          </Button>
        </div>
      </div>
    );
  }

  return <StaffChecklist user={user!} onLogout={() => void handleLogout()} />;
}
