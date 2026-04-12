'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
} from 'lucide-react';
import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';
import { useTodayTasks } from '@/hooks/use-tasks';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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

export interface DriverDashboardProps {
  route: StaffDeliveryRouteDetail | null;
  routeLoading: boolean;
  routeError: boolean;
  onRefetch: () => void;
  onLogout: () => void;
}

export function DriverDashboard({ route, routeLoading, routeError, onRefetch, onLogout }: DriverDashboardProps) {
  const strings = useStaffStrings();
  const d = strings.driver.dashboard;
  const { data: tasksData, isLoading: tasksLoading } = useTodayTasks();

  const tasks = tasksData?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  const issueTasks = tasks.filter((t) => t.status === 'issue').length;

  const routeStops = route?.stops?.length ?? 0;
  const routeDone = route?.stops?.filter((s) => s.status === 'done').length ?? 0;
  const hasRoute = Boolean(route && routeStops > 0);
  const assigned = route?.status === 'assigned';
  const inProgress = route?.status === 'in_progress';
  const completedRoute = route?.status === 'completed';

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
          <Button
            type="button"
            variant="ghost"
            aria-label={strings.driver.logout}
            className="h-10 w-10 shrink-0 rounded-full p-0 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => void onLogout()}
          >
            <LogOut size={20} />
          </Button>
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
        ) : hasRoute && !completedRoute ? (
          <div className={widgetCardClass(true)}>
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-700 dark:text-teal-300">
                <MapPin className="h-7 w-7" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-800/90 dark:text-teal-300/90">
                  {inProgress ? d.routeInProgressTitle : d.routeAssignedTitle}
                </p>
                <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {d.routeLine(routeStops, formatScheduleDate(route!.scheduledDate))}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {d.progressShort(routeDone, routeStops)}
                </p>
              </div>
            </div>
            <Link
              href="/driver/route"
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-slate-900 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {inProgress ? d.ctaContinue : d.ctaStart}
            </Link>
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

        {hasRoute && !completedRoute ? (
          <section className={widgetCardClass()} aria-labelledby="dash-stats">
            <h2 id="dash-stats" className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <CheckCircle2 className="h-4 w-4 text-teal-600" aria-hidden />
              {d.sectionStats}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{d.statsFromRoute(routeDone, routeStops)}</p>
          </section>
        ) : !routeLoading && !routeError ? (
          <section className={widgetCardClass()} aria-labelledby="dash-stats-idle">
            <h2 id="dash-stats-idle" className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              {d.sectionStats}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{d.statsIdle}</p>
          </section>
        ) : null}

        <section className={widgetCardClass()} aria-labelledby="dash-tomorrow">
          <h2 id="dash-tomorrow" className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
            {d.sectionTomorrow}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{d.tomorrowPlaceholder}</p>
        </section>

        <section className={widgetCardClass()} aria-labelledby="dash-tasks">
          <h2 id="dash-tasks" className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <ClipboardList className="h-4 w-4 text-slate-500" aria-hidden />
            {d.sectionTasks}
          </h2>
          {tasksLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">{d.tasksOpenCount(openTasks)}</p>
          )}
          <Link
            href="/tasks"
            className={cn(
              'mt-3 inline-flex h-10 w-full items-center justify-center rounded-full border border-slate-200 bg-white/90 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {d.tasksLink}
          </Link>
        </section>

        <section className={widgetCardClass()} aria-labelledby="dash-issues">
          <h2 id="dash-issues" className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
            {d.sectionIssues}
          </h2>
          {tasksLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
          ) : issueTasks > 0 ? (
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{d.issuesCount(issueTasks)}</p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">{d.issuesClear}</p>
          )}
          {issueTasks > 0 ? (
            <Link
              href="/tasks"
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full border border-amber-200 bg-white/90 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-50 dark:border-amber-900 dark:bg-slate-900 dark:text-amber-100 dark:hover:bg-amber-950/40"
            >
              {d.tasksLink}
            </Link>
          ) : null}
        </section>

        <section className={widgetCardClass()} aria-labelledby="dash-history">
          <h2 id="dash-history" className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <History className="h-4 w-4 text-slate-500" aria-hidden />
            {d.sectionHistory}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{d.historyPlaceholder}</p>
        </section>

        {hasRoute && !completedRoute ? (
          <Link
            href="/driver/route"
            className="inline-flex h-10 w-full items-center justify-center rounded-full text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {d.ctaOpenRoute}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
