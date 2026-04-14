'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CalendarDays, History, Loader2, LogOut, MapPin, Package, RefreshCw } from 'lucide-react';
import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StaffHistoryDrawer } from '@/components/tasks/staff-history-drawer';

function formatScheduleDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
}

function widgetCardClass(elevated?: boolean) {
  return cn(
    'rounded-2xl border p-4 text-left shadow-sm dark:shadow-none',
    elevated
      ? 'border-teal-200/80 bg-gradient-to-br from-teal-50/90 to-white dark:border-teal-900/50 dark:from-teal-950/40 dark:to-slate-900'
      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
  );
}

/** Как `StaffHistoryFab` в чеклисте уборки: крупная зона нажатия и иконка h-5 w-5 */
const driverHeaderIconBtnClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-transform active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-teal-200 dark:shadow-none';

export interface DriverDashboardProps {
  routes: StaffDeliveryRouteDetail[] | null;
  routeLoading: boolean;
  routeError: boolean;
  onRefetch: () => void;
  onLogout: () => void;
  /** Старт маршрута с главной: сразу POST /start, затем переход (без второй кнопки на странице маршрута). */
  onStartAssignedRoute?: (routeId: string) => Promise<void>;
  startingRouteId?: string | null;
}

export function DriverDashboard({
  routes,
  routeLoading,
  routeError,
  onRefetch,
  onLogout,
  onStartAssignedRoute,
  startingRouteId,
}: DriverDashboardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const strings = useStaffStrings();
  const d = strings.driver.dashboard;
  const list = routes ?? [];
  const hasAnyRoute = list.length > 0;
  const totalStops = list.reduce((acc, r) => acc + (r.stops?.length ?? 0), 0);
  const totalDone = list.reduce(
    (acc, r) => acc + (r.stops?.filter((s) => s.status === 'done')?.length ?? 0),
    0,
  );
  const hasRoute = hasAnyRoute && totalStops > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 pb-[max(1.5rem,env(safe-area-inset-bottom))] dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
              {strings.driver.badge}
            </p>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{d.pageTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={d.sectionTomorrow}
              className={driverHeaderIconBtnClass}
              onClick={() => toast.info(d.tomorrowPlaceholder)}
            >
              <CalendarDays className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={strings.tasks.history.fabAria}
              className={driverHeaderIconBtnClass}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={strings.driver.logout}
              className={driverHeaderIconBtnClass}
              onClick={() => void onLogout()}
            >
              <LogOut className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {routeLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : routeError ? (
          <div className={cn(widgetCardClass(), 'text-center')}>
            <p className="text-sm text-slate-600 dark:text-slate-300">{strings.driver.route.error.message}</p>
            <Button type="button" className="mt-3 rounded-full" variant="secondary" onClick={() => void onRefetch()}>
              {d.refresh}
            </Button>
          </div>
        ) : hasRoute ? (
          <div className="flex flex-col gap-3">
            {list.map((route) => {
              const routeStops = route.stops?.length ?? 0;
              const routeDone = route.stops?.filter((s) => s.status === 'done')?.length ?? 0;
              const assigned = route.status === 'assigned';
              const inProgress = route.status === 'in_progress';
              const completed = route.status === 'completed';
              const href = `/driver/route?routeId=${encodeURIComponent(route.id)}`;
              const startingThis = startingRouteId === route.id;
              return (
                <div key={route.id} className={widgetCardClass(true)}>
                  <div className="mb-3 flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-700 dark:text-teal-300">
                      <MapPin className="h-7 w-7" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold uppercase tracking-wide text-teal-800/90 dark:text-teal-300/90">
                        {completed
                          ? d.routeCompletedTitle
                          : inProgress
                            ? d.routeInProgressTitle
                            : d.routeAssignedTitle}
                        {list.length > 1 ? (
                          <span className="ml-1 font-normal normal-case text-slate-500 dark:text-slate-400">
                            · {route.scheduledDate}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                        {d.routeLine(routeStops, formatScheduleDate(route.scheduledDate))}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {d.progressShort(routeDone, routeStops)}
                      </p>
                    </div>
                  </div>
                  {completed ? (
                    <Link
                      href={href}
                      className="inline-flex h-12 w-full items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      {d.ctaOpenRoute}
                    </Link>
                  ) : assigned && onStartAssignedRoute ? (
                    <button
                      type="button"
                      disabled={startingThis}
                      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-70 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                      onClick={() => void onStartAssignedRoute(route.id)}
                    >
                      {startingThis ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                          {d.ctaStarting}
                        </>
                      ) : (
                        d.ctaStart
                      )}
                    </button>
                  ) : (
                    <Link
                      href={href}
                      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    >
                      {inProgress ? d.ctaContinue : d.ctaStart}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={widgetCardClass()}>
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <Package className="h-6 w-6 text-slate-500" aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{d.emptyTitle}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{d.emptyBody}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full rounded-full"
              onClick={() => void onRefetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              {d.refresh}
            </Button>
          </div>
        )}
      </div>

      <StaffHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
