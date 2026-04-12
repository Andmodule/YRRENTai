'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DeliveryRouteDetailBody } from './delivery-route-detail-body';
import {
  useAssignDeliveryRouteDriver,
  useDeliveryRouteDetail,
  useDeliveryRoutesList,
} from '../../hooks/useDeliveryRoutes';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useMatchMedia } from '@/hooks/use-match-media';

type StaffMember = { id: string; displayName: string; role: string };

function useStaffForAssign() {
  return useQuery({
    queryKey: ['users', 'staff-assignees'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: StaffMember[] }>('/users/staff');
      return res.data.data;
    },
    staleTime: 60_000,
  });
}

export function ManagerDeliveryRoutesView() {
  const t = useTranslations('tasks.managerSupply');
  const isMdUp = useMatchMedia('(min-width: 768px)');
  const { data: routes, isLoading, isError, refetch } = useDeliveryRoutesList();
  const { data: staff } = useStaffForAssign();
  const { mutate: assignDriver, isPending: assignPending } = useAssignDeliveryRouteDriver();

  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: detail, isFetching: detailLoading } = useDeliveryRouteDetail(detailId, Boolean(detailId));

  const [assignRouteId, setAssignRouteId] = useState<string | null>(null);
  const [pickDriver, setPickDriver] = useState<string>('');

  const openDetail = (id: string) => {
    setDetailId(id);
    setAssignRouteId(null);
  };

  const statusClass = (s: string) =>
    cn(
      'text-[10px] font-semibold',
      s === 'draft' && 'border-slate-400/40 bg-slate-500/10 text-slate-800 dark:text-slate-200',
      s === 'assigned' && 'border-[#008CA4]/35 bg-[#E0F2F5]/90 text-[#006a7a] dark:bg-[#00d4ff]/12 dark:text-[#a5f3fc]',
      s === 'in_progress' && 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100',
      s === 'completed' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    );

  const routeStatusLabel = (s: string) => t(`deliveryRouteStatus.${s}` as Parameters<typeof t>[0]);

  const onAssign = () => {
    if (!assignRouteId || !pickDriver) {
      toast.message(t('deliveryRouteAssignNeedDriver'));
      return;
    }
    assignDriver(
      { routeId: assignRouteId, driverUserId: pickDriver },
      {
        onSuccess: () => {
          toast.success(t('deliveryRouteAssignSuccess'));
          setAssignRouteId(null);
          setPickDriver('');
          void refetch();
        },
        onError: () => toast.error(t('deliveryRouteAssignError')),
      },
    );
  };

  const sortedRoutes = useMemo(() => {
    if (!routes?.length) return [];
    return [...routes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [routes]);

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 text-sm text-destructive">
        {t('deliveryRoutesLoadError')}{' '}
        <button type="button" className="underline" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <p className="mx-4 text-[11px] leading-snug text-muted-foreground">{t('deliveryRoutesHint')}</p>

      {!sortedRoutes.length ? (
        <p className="mx-4 rounded-lg border border-dashed border-border/40 bg-muted/15 px-3 py-8 text-center text-sm text-muted-foreground">
          {t('deliveryRoutesEmpty')}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain px-4 pb-4 [-webkit-overflow-scrolling:touch]">
          {sortedRoutes.map((r) => (
            <li
              key={r.id}
              className={cn(
                'rounded-xl border bg-card p-3 shadow-sm dark:border-border/50',
                r.status === 'completed'
                  ? 'border-emerald-500/40 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08]'
                  : 'border-border/60',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        r.status === 'completed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-foreground',
                      )}
                    >
                      {t('deliveryRouteDateLabel', { date: r.scheduledDate })}
                    </span>
                    <Badge variant="secondary" className={statusClass(r.status)}>
                      {routeStatusLabel(r.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.warehouseLabel ? `${r.warehouseLabel} · ` : ''}
                    {t('deliveryRouteStopsCount', { count: r.stopsCount })}
                    {r.driverName ? ` · ${r.driverName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => openDetail(r.id)}>
                    {t('deliveryRouteOpenDetail')}
                  </Button>
                  {r.status === 'draft' || r.status === 'assigned' ? (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#008CA4] text-white hover:bg-[#007a90] dark:bg-[#00a8c4]"
                      onClick={() => {
                        setAssignRouteId(r.id);
                        setPickDriver(r.driverUserId ?? '');
                        setDetailId(null);
                      }}
                    >
                      <UserCircle className="mr-1 h-3.5 w-3.5" />
                      {t('deliveryRouteAssign')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Drawer open={assignRouteId !== null} onOpenChange={(o) => !o && setAssignRouteId(null)}>
        <DrawerContent title={t('deliveryRouteAssignTitle')} description={t('deliveryRouteAssignHint')}>
          <div className="space-y-4 px-4 pb-6 pt-2">
            <Select
              className="w-full"
              value={pickDriver}
              onChange={(e) => setPickDriver(e.target.value)}
              aria-label={t('deliveryRouteAssignPlaceholder')}
            >
              <option value="">{t('deliveryRouteAssignPlaceholder')}</option>
              {(staff ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.role})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              className="w-full bg-[#008CA4] text-white hover:bg-[#007a90]"
              disabled={assignPending || !pickDriver}
              onClick={() => onAssign()}
            >
              {assignPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('deliveryRouteAssignSubmit')}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {isMdUp ? (
        <Sheet open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
          <SheetContent title={t('deliveryRouteDetailTitle')} description={t('deliveryRouteDetailHint')}>
            <div className="space-y-4">
              <DeliveryRouteDetailBody
                detail={detail}
                detailLoading={detailLoading}
                emptyLabel={t('deliveryRouteDetailEmpty')}
                t={t as (key: string) => string}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Drawer open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
          <DrawerContent title={t('deliveryRouteDetailTitle')} description={t('deliveryRouteDetailHint')}>
            <div className="max-h-[min(70vh,520px)] space-y-4 overflow-y-auto">
              <DeliveryRouteDetailBody
                detail={detail}
                detailLoading={detailLoading}
                emptyLabel={t('deliveryRouteDetailEmpty')}
                t={t as (key: string) => string}
              />
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
