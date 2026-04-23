'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Clapperboard, Eye, History, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';
import type { Task } from '@/hooks/use-tasks';
import { useStaffIncidentHistory, type StaffIncidentHistoryItem } from '@/hooks/use-tasks';
import { useStaffStrings, type StaffStrings } from '@/locales/staff-strings';
import { isVideoAttachmentUrl } from '@/lib/media-url';
import { isIncidentCreatedBeforeToday, isTaskDoneBeforeToday } from '@/lib/staff-history-date';
import { cn } from '@/lib/utils';
import {
  StaffHistoryDetailDrawer,
  type StaffHistoryDetailState,
} from './staff-history-detail-drawer';

function formatRouteScheduleDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
}

function taskTypeLabel(type: string): string {
  const m: Record<string, string> = {
    checkout_cleaning: 'Уборка (выезд)',
    checkin_prep: 'Подготовка к заезду',
    mid_stay_cleaning: 'Плановая уборка',
    manual: 'Задача',
  };
  return m[type] ?? type;
}

const segmentBar = 'mb-3 flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/90';
const segmentActive = 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100';
const segmentIdle = 'text-slate-600 dark:text-slate-400';

function CompletedRouteHistoryRow({
  route,
  onNavigate,
  h,
}: {
  route: StaffDeliveryRouteDetail;
  onNavigate: () => void;
  h: StaffStrings['tasks']['history'];
}) {
  const routeStops = route.stops?.length ?? 0;
  const routeDone = route.stops?.filter((s) => s.status === 'done')?.length ?? 0;
  const href = `/driver/route?routeId=${encodeURIComponent(route.id)}`;
  const dateLine = formatRouteScheduleDate(route.scheduledDate);
  const sub = h.completedRouteStops(routeDone, routeStops);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-sm transition-colors hover:border-teal-200/90 hover:bg-teal-50/50 active:bg-teal-50/60 dark:border-slate-700/90 dark:bg-slate-800/70 dark:hover:border-teal-800/50 dark:hover:bg-slate-800/90"
      aria-label={`${dateLine}. ${sub}`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-400/25 dark:text-teal-300">
        <MapPin className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{dateLine}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
    </Link>
  );
}

export function StaffHistoryDrawer({
  open,
  onOpenChange,
  tasks = [],
  completedDeliveryRoutes,
  variant = 'cleaner',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks?: Task[];
  completedDeliveryRoutes?: StaffDeliveryRouteDetail[];
  variant?: 'cleaner' | 'driver';
}) {
  const strings = useStaffStrings();
  const h = strings.tasks.history;
  const [tab, setTab] = useState<'tasks' | 'incidents' | 'routes'>('tasks');
  const { data: incidents, isLoading: incidentsLoading } = useStaffIncidentHistory(open);
  const [historyDetail, setHistoryDetail] = useState<StaffHistoryDetailState>(null);

  useEffect(() => {
    if (!open) return;
    if (variant === 'driver') {
      setTab('routes');
    } else {
      setTab('tasks');
    }
  }, [open, variant]);

  useEffect(() => {
    if (!open) setHistoryDetail(null);
  }, [open]);

  const doneTasksPast = useMemo(() => {
    return tasks
      .filter((t) => isTaskDoneBeforeToday(t))
      .sort((a, b) => {
        const ac = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bc = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bc - ac;
      });
  }, [tasks]);

  const pastIncidents = useMemo(() => {
    if (!incidents?.length) return [];
    return incidents
      .filter((i) => isIncidentCreatedBeforeToday(i.createdAt))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [incidents]);

  const completedRoutes = completedDeliveryRoutes ?? [];
  const tasksTabEmpty = doneTasksPast.length === 0;
  const hintText = variant === 'driver' ? h.hintDriver : h.hint;

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent title={h.drawerTitle}>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{hintText}</p>

          {variant === 'driver' ? (
            <div className={segmentBar}>
              <button
                type="button"
                className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors', tab === 'routes' ? segmentActive : segmentIdle)}
                onClick={() => setTab('routes')}
              >
                {h.tabRoutes}
              </button>
              <button
                type="button"
                className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors', tab === 'incidents' ? segmentActive : segmentIdle)}
                onClick={() => setTab('incidents')}
              >
                {h.tabIncidents}
              </button>
            </div>
          ) : (
            <div className={segmentBar}>
              <button
                type="button"
                className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors', tab === 'tasks' ? segmentActive : segmentIdle)}
                onClick={() => setTab('tasks')}
              >
                {h.tabTasks}
              </button>
              <button
                type="button"
                className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors', tab === 'incidents' ? segmentActive : segmentIdle)}
                onClick={() => setTab('incidents')}
              >
                {h.tabIncidents}
              </button>
            </div>
          )}

          <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
            {variant === 'driver' && tab === 'routes' &&
              (completedRoutes.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{h.emptyRoutes}</p>
              ) : (
                completedRoutes.map((route) => (
                  <CompletedRouteHistoryRow
                    key={route.id}
                    route={route}
                    h={h}
                    onNavigate={() => onOpenChange(false)}
                  />
                ))
              ))}

            {variant === 'cleaner' && tab === 'tasks' &&
              (tasksTabEmpty ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{h.emptyTasksPast}</p>
              ) : (
                doneTasksPast.map((t) => {
                  const urls = t.photoUrls ?? [];
                  const hasMedia = urls.length > 0;
                  const line = [taskTypeLabel(t.type), t.propertyTitle, t.contextLabel].filter(Boolean).join(' · ');
                  return (
                    <button
                      key={t.uuid}
                      type="button"
                      onClick={() => setHistoryDetail({ kind: 'task', task: t })}
                      className="w-full rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-sm transition-colors hover:border-teal-200/90 hover:bg-teal-50/40 active:bg-teal-50/60 dark:border-slate-700/90 dark:bg-slate-800/60 dark:hover:border-teal-800/50 dark:hover:bg-slate-800/80"
                    >
                      <p className="font-medium text-slate-900 dark:text-slate-100">{line}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {t.completedAt
                          ? format(parseISO(t.completedAt), 'd MMM yyyy, HH:mm', { locale: ru })
                          : t.dueDate}
                        {hasMedia ? (
                          <span className="ml-2 text-emerald-700 dark:text-emerald-400">· {h.taskHasPhotoBadge}</span>
                        ) : (
                          <span className="ml-2 text-amber-700 dark:text-amber-500">· {h.taskNoPhotoBadge}</span>
                        )}
                      </p>
                    </button>
                  );
                })
              ))}

            {tab === 'incidents' &&
              (incidentsLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-600 dark:text-teal-400" aria-hidden />
                </div>
              ) : !pastIncidents.length ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{h.emptyIncidentsPast}</p>
              ) : (
                pastIncidents.map((inc) => (
                  <IncidentHistoryRow
                    key={inc.uuid}
                    item={inc}
                    onViewMedia={() => setHistoryDetail({ kind: 'incident', item: inc })}
                  />
                ))
              ))}
          </div>
        </DrawerContent>
      </Drawer>

      <StaffHistoryDetailDrawer
        detail={historyDetail}
        onOpenChange={(o) => {
          if (!o) setHistoryDetail(null);
        }}
      />
    </>
  );
}

function IncidentHistoryRow({
  item,
  onViewMedia,
}: {
  item: StaffIncidentHistoryItem;
  onViewMedia: () => void;
}) {
  const h = useStaffStrings().tasks.history;
  const typeLabel = h.typeLabels[item.type] ?? item.type;
  const hasMedia = (item.photoUrls?.length ?? 0) > 0;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-sm dark:border-slate-700/90 dark:bg-slate-800/60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{typeLabel}</p>
          <p className="font-medium text-slate-900 dark:text-slate-100">{item.propertyTitle}</p>
          <p className="mt-1 line-clamp-3 text-slate-600 dark:text-slate-300">{item.descriptionPreview}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {format(parseISO(item.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })} · {h.photosCount(item.photoUrls.length)}
          </p>
          {item.photoUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.photoUrls.slice(0, 4).map((url) =>
                isVideoAttachmentUrl(url) ? (
                  <div
                    key={url}
                    className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900/90 ring-1 ring-slate-200/80"
                  >
                    <Clapperboard className="h-5 w-5 text-white/90" />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200/80"
                  />
                ),
              )}
            </div>
          )}
        </div>
        {hasMedia ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1 rounded-lg border-teal-200/90 text-teal-900 dark:border-teal-800 dark:text-teal-100"
            onClick={onViewMedia}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            {h.viewMedia}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function StaffHistoryFab({ onClick }: { onClick: () => void }) {
  const h = useStaffStrings().tasks.history;
  return (
    <button
      type="button"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-transform active:scale-95"
      aria-label={h.fabAria}
      onClick={onClick}
    >
      <History className="h-5 w-5" aria-hidden />
    </button>
  );
}
