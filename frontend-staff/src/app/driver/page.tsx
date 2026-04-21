'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useStaffDeliveryRoutesList, useStartDeliveryRoute } from '@/hooks/use-staff-delivery-route';
import { resolveStaffAppShell } from '@/lib/staff-app-shell';
import { parseRouteUuidFromTelegramStartParam, readTelegramWebAppStartParam } from '@/lib/telegram-start-param';
import { apiClient } from '@/lib/api/client';
import { DriverDashboard } from '@/modules/driver/components/DriverDashboard';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function DriverDashboardPage() {
  const { user, error, isLoading, isAuthenticated, isStaff } = useAuth();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const shellDriver =
    user?.role === 'STAFF' && user?.staffJobType != null && resolveStaffAppShell(user.staffJobType) === 'driver';

  const {
    data: routes,
    isLoading: routeLoading,
    isError: routeError,
    refetch: refetchRoute,
  } = useStaffDeliveryRoutesList(Boolean(shellDriver && isAuthenticated));

  const startRoute = useStartDeliveryRoute();
  const [startingRouteId, setStartingRouteId] = useState<string | null>(null);
  const routeTgSyncedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !shellDriver) return;
    if (routeTgSyncedRef.current) return;
    const rid = parseRouteUuidFromTelegramStartParam(readTelegramWebAppStartParam());
    if (!rid) return;
    routeTgSyncedRef.current = true;
    router.replace(`/driver/route?routeId=${encodeURIComponent(rid)}`);
  }, [isAuthenticated, shellDriver, router]);

  const handleStartAssignedRoute = useCallback(
    async (routeId: string) => {
      setStartingRouteId(routeId);
      try {
        await startRoute.mutateAsync(routeId);
        await refetchRoute();
        router.push(`/driver/route?routeId=${encodeURIComponent(routeId)}`);
      } finally {
        setStartingRouteId(null);
      }
    },
    [startRoute, refetchRoute, router],
  );

  useEffect(() => {
    if (isLoading) return;
    if (error || !isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (user?.role === 'STAFF' && resolveStaffAppShell(user.staffJobType) !== 'driver') {
      router.replace('/tasks');
    }
  }, [isLoading, error, isAuthenticated, user, router]);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      await globalMutate('staff-auth/me', undefined, { revalidate: false });
      router.replace('/login');
    }
  };

  if (isLoading && !error) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-slate-600">Доступ только для персонала.</p>
        <Button type="button" variant="outline" onClick={() => void handleLogout()}>
          <LogOut className="mr-2 h-4 w-4" />
          Выйти
        </Button>
      </div>
    );
  }

  if (resolveStaffAppShell(user?.staffJobType) !== 'driver') {
    return null;
  }

  return (
    <DriverDashboard
      routes={routes ?? null}
      routeLoading={routeLoading}
      routeError={routeError}
      onRefetch={() => void refetchRoute()}
      onLogout={handleLogout}
      onStartAssignedRoute={handleStartAssignedRoute}
      startingRouteId={startingRouteId}
    />
  );
}
