'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { resolveStaffAppShell } from '@/lib/staff-app-shell';
import {
  parseRouteUuidFromTelegramStartParam,
  parseTaskUuidFromTelegramStartParam,
  readTelegramWebAppStartParam,
} from '@/lib/telegram-start-param';
import { Skeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  const { user, isLoading, error, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (error || !isAuthenticated) {
      router.replace('/login');
      return;
    }
    const tgSp = readTelegramWebAppStartParam();
    const taskDeep = parseTaskUuidFromTelegramStartParam(tgSp);
    const routeDeep = parseRouteUuidFromTelegramStartParam(tgSp);
    if (taskDeep) {
      router.replace(`/tasks?task=${encodeURIComponent(taskDeep)}`);
      return;
    }
    if (routeDeep) {
      router.replace(`/driver/route?routeId=${encodeURIComponent(routeDeep)}`);
      return;
    }
    if (tgSp === 'tasks') {
      if (user?.role === 'STAFF' && resolveStaffAppShell(user.staffJobType) === 'driver') {
        router.replace('/driver');
      } else {
        router.replace('/tasks');
      }
      return;
    }

    if (user?.role === 'STAFF') {
      const shell = resolveStaffAppShell(user.staffJobType);
      router.replace(shell === 'driver' ? '/driver' : '/tasks');
      return;
    }
    router.replace('/tasks');
  }, [isLoading, error, isAuthenticated, user, router]);

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4">
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}
