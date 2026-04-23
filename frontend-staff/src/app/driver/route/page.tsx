'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import {
  useCompleteStop,
  useSetDriverNextStop,
  useStaffDeliveryRoutesList,
  useStartDeliveryRoute,
} from '@/hooks/use-staff-delivery-route';
import { useTasksSocket } from '@/hooks/use-tasks-socket';
import { resolveStaffAppShell } from '@/lib/staff-app-shell';
import { parseRouteUuidFromTelegramStartParam, readTelegramWebAppStartParam } from '@/lib/telegram-start-param';
import { apiClient } from '@/lib/api/client';
import { staffDriverShortLabel } from '@/lib/staff-driver-display-name';
import { ActiveRouteTimeline } from '@/modules/driver/components/ActiveRouteTimeline';
import {
  StaffHistorySupplementSheet,
  type StaffSupplementContext,
} from '@/components/tasks/staff-history-supplement-sheet';
import {
  StaffVoiceReportSheet,
  type StaffVoiceReportSheetHandle,
} from '@/components/tasks/staff-voice-report-sheet';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function DriverRoutePage() {
  const { user, error, isLoading, isAuthenticated, isStaff } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate: globalMutate } = useSWRConfig();
  const shellDriver =
    user?.role === 'STAFF' && user?.staffJobType != null && resolveStaffAppShell(user.staffJobType) === 'driver';

  const {
    data: routes,
    isLoading: routeLoading,
    isError: routeError,
    refetch: refetchRoute,
  } = useStaffDeliveryRoutesList(Boolean(shellDriver && isAuthenticated));

  useTasksSocket(user?.id);

  const routeIdParam = searchParams.get('routeId');
  const route = useMemo(() => {
    const list = routes ?? [];
    if (!list.length) return null;
    if (routeIdParam) {
      const found = list.find((r) => r.id === routeIdParam);
      if (found) return found;
    }
    return list[0] ?? null;
  }, [routes, routeIdParam]);

  const driverShortName = useMemo(() => staffDriverShortLabel(user), [user]);

  const start = useStartDeliveryRoute();
  const complete = useCompleteStop();
  const setNextStop = useSetDriverNextStop();

  const [starting, setStarting] = useState(false);
  const [pendingCompleteId, setPendingCompleteId] = useState<string | null>(null);

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceRouteCtx, setVoiceRouteCtx] = useState<{ propertyId: string; label: string } | null>(null);
  const [supplementCtx, setSupplementCtx] = useState<StaffSupplementContext | null>(null);
  const voiceRef = useRef<StaffVoiceReportSheetHandle>(null);
  const tgRouteIdSyncedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !shellDriver) return;
    if (routeIdParam) return;
    if (tgRouteIdSyncedRef.current) return;
    const rid = parseRouteUuidFromTelegramStartParam(readTelegramWebAppStartParam());
    if (!rid) return;
    tgRouteIdSyncedRef.current = true;
    router.replace(`/driver/route?routeId=${encodeURIComponent(rid)}`);
  }, [isAuthenticated, shellDriver, routeIdParam, router]);

  const openVoiceForProperty = useCallback((ctx: { propertyId: string; label: string }) => {
    setVoiceRouteCtx(ctx);
    flushSync(() => {
      setVoiceOpen(true);
    });
    voiceRef.current?.startRecordingFromUserGesture();
  }, []);

  const openTextForProperty = useCallback((ctx: { propertyId: string; label: string }) => {
    setSupplementCtx({
      kind: 'property',
      id: ctx.propertyId,
      label: ctx.label,
    });
  }, []);

  const handleVoiceOpenChange = useCallback((o: boolean) => {
    setVoiceOpen(o);
    if (!o) setVoiceRouteCtx(null);
  }, []);

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

  const handleStartRoute = async () => {
    if (!route) return;
    setStarting(true);
    try {
      await start.mutateAsync(route.id);
    } finally {
      setStarting(false);
    }
  };

  const handleCompleteStop = async (stopId: string) => {
    setPendingCompleteId(stopId);
    try {
      await complete.mutateAsync(stopId);
      await refetchRoute();
    } finally {
      setPendingCompleteId(null);
    }
  };

  const handleSetDriverNextStop = useCallback(
    async (stopId: string) => {
      if (!route?.id) return;
      await setNextStop.mutateAsync({ routeId: route.id, stopId });
    },
    [route?.id, setNextStop],
  );

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
    <>
      <ActiveRouteTimeline
        route={route ?? null}
        isLoading={routeLoading}
        isError={routeError}
        onRefetch={() => void refetchRoute()}
        onStartRoute={handleStartRoute}
        onCompleteStop={handleCompleteStop}
        isStarting={starting}
        pendingCompleteId={pendingCompleteId}
        onVoiceForActiveProperty={openVoiceForProperty}
        onTextForActiveProperty={openTextForProperty}
        onSetDriverNextStop={handleSetDriverNextStop}
        settingNextStopId={setNextStop.isPending ? setNextStop.variables?.stopId ?? null : null}
        overviewHref="/driver"
        driverShortName={driverShortName}
        deliveryRoutesAll={routes ?? null}
        driverUserId={user?.id ?? null}
      />
      <StaffHistorySupplementSheet
        open={!!supplementCtx}
        context={supplementCtx}
        onOpenChange={(o) => {
          if (!o) setSupplementCtx(null);
        }}
      />
      <StaffVoiceReportSheet
        ref={voiceRef}
        open={voiceOpen}
        onOpenChange={handleVoiceOpenChange}
        initialMode="INCIDENT"
        taskOptions={[]}
        defaultTaskUuid=""
        routePropertyId={voiceRouteCtx?.propertyId ?? null}
        routePropertyLabel={voiceRouteCtx?.label ?? null}
      />
    </>
  );
}
