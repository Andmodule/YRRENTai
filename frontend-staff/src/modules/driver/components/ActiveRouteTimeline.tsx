'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Mic,
  Navigation,
  Package,
  Pencil,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StaffDeliveryRouteDetail } from '@/hooks/use-staff-delivery-route';
import type { StaffStrings } from '@/locales/staff-strings';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';
import { mapStaffRouteToActiveData } from '@/modules/driver/map-staff-route';
import type { ActiveRouteData, RouteItem, RouteStop } from '@/modules/driver/types/route.types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Микрофон / карандаш / навигатор — один размер */
const cardActionBtnClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-200/90 bg-gradient-to-b from-amber-50 to-teal-50/80 text-teal-700 shadow-sm ring-1 ring-amber-100/80 transition-colors hover:border-amber-300 hover:bg-amber-50 active:scale-95 dark:border-amber-600/50 dark:from-teal-950/60 dark:to-amber-950/40 dark:text-teal-200 dark:ring-amber-900/40';

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}

function openMapsQuery(query: string) {
  const q = query.trim();
  if (!q) return;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

type DriverRouteCopy = StaffStrings['driver']['route'];

function stopHeading(stop: RouteStop, tr: DriverRouteCopy): string {
  if (stop.kind === 'warehouse') {
    return stop.warehouseLabel ? `${tr.warehouseTitle} · ${stop.warehouseLabel}` : tr.warehouseTitle;
  }
  return stop.propertyTitle ?? tr.propertyFallback;
}

function stopAddress(stop: RouteStop, tr: DriverRouteCopy): string {
  if (stop.kind === 'warehouse') return tr.warehouseAddressHint;
  return stop.propertyAddress ?? '';
}

function propertyReportLabel(stop: RouteStop, tr: DriverRouteCopy): string {
  const title = stop.propertyTitle ?? tr.propertyFallback;
  const addr = stop.propertyAddress?.trim() ?? '';
  return addr ? `${title} · ${addr}` : title;
}

function navigateQuery(stop: RouteStop, tr: DriverRouteCopy): string {
  if (stop.kind === 'warehouse') {
    return (stop.warehouseLabel ?? tr.warehouseTitle).trim();
  }
  return (stop.propertyAddress ?? stop.propertyTitle ?? '').trim();
}

function warehouseDone(stops: RouteStop[]): boolean {
  const wh = stops.find((s) => s.kind === 'warehouse');
  return !wh || wh.status === 'completed';
}

type ItemsGroupProps = {
  title: string;
  items: RouteItem[];
  variant: 'pickup' | 'dropoff';
};

function ItemsGroup({ title, items, variant }: ItemsGroupProps) {
  if (items.length === 0) return null;

  const isDropoff = variant === 'dropoff';
  const Icon = isDropoff ? Upload : Download;
  const containerClass = isDropoff
    ? 'border-teal-100/50 bg-teal-50/50 dark:border-teal-900/40 dark:bg-teal-950/30'
    : 'border-orange-100/50 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/30';
  const headerClass = isDropoff
    ? 'text-teal-700 dark:text-teal-300'
    : 'text-orange-600 dark:text-orange-400';
  const iconClass = isDropoff ? 'text-teal-500' : 'text-orange-500';

  return (
    <div className={cn('rounded-xl border p-3', containerClass)}>
      <div className={cn('mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider', headerClass)}>
        <Icon size={14} aria-hidden />
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 text-sm font-medium text-slate-800 dark:text-slate-100"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Package size={16} className={cn('shrink-0', iconClass)} aria-hidden />
              <span className="min-w-0 break-words">{item.name}</span>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded-md border border-slate-100 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
              {formatQty(item.quantity)}
              {item.unit ? ` ${item.unit}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ActiveRouteTimelineProps {
  route: StaffDeliveryRouteDetail | null;
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onStartRoute: () => Promise<void>;
  onCompleteStop: (stopId: string) => Promise<void>;
  onLogout: () => void;
  isStarting: boolean;
  pendingCompleteId: string | null;
  /** Отчёт по объекту активной остановки (маршрут), без привязки к задаче уборки */
  onVoiceForActiveProperty?: (ctx: { propertyId: string; label: string }) => void;
  onTextForActiveProperty?: (ctx: { propertyId: string; label: string }) => void;
  /** После склада: сделать объект следующей остановкой */
  onSetDriverNextStop?: (stopId: string) => Promise<void>;
  settingNextStopId?: string | null;
  /** Ссылка на сводку водителя */
  overviewHref?: string;
}

export function ActiveRouteTimeline({
  route,
  isLoading,
  isError,
  onRefetch,
  onStartRoute,
  onCompleteStop,
  onLogout,
  isStarting,
  pendingCompleteId,
  onVoiceForActiveProperty,
  onTextForActiveProperty,
  onSetDriverNextStop,
  settingNextStopId,
  overviewHref,
}: ActiveRouteTimelineProps) {
  const strings = useStaffStrings();
  const tr = strings.driver.route;
  const dash = strings.driver.dashboard;

  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);

  const data: ActiveRouteData | null = useMemo(
    () => (route ? mapStaffRouteToActiveData(route) : null),
    [route],
  );

  const canChooseNext = Boolean(
    data && data.routeStatus === 'in_progress' && warehouseDone(data.stops) && onSetDriverNextStop,
  );

  useEffect(() => {
    if (!data?.stops.some((s) => s.id === expandedStopId)) setExpandedStopId(null);
  }, [data, expandedStopId]);

  const handleSetNext = useCallback(
    async (stopId: string) => {
      if (!onSetDriverNextStop) return;
      try {
        await onSetDriverNextStop(stopId);
        setExpandedStopId(null);
      } catch {
        toast.error('Не удалось сохранить выбор');
      }
    },
    [onSetDriverNextStop],
  );

  if (isLoading) {
    return (
      <div
        className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))] dark:bg-slate-950"
        aria-busy
      >
        <Skeleton className="mb-8 h-16 w-full rounded-xl" />
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-slate-50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-center dark:bg-slate-950">
        <p className="text-sm text-slate-600 dark:text-slate-300">{tr.error.message}</p>
        <Button type="button" className="mt-4 rounded-full" variant="secondary" onClick={() => void onRefetch()}>
          {tr.error.retry}
        </Button>
      </div>
    );
  }

  if (!route || !data || data.stops.length === 0) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-slate-50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-center dark:bg-slate-950">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950/50">
          <CheckCircle2 size={48} className="text-teal-500" aria-hidden />
        </div>
        <h2 className="mb-2 text-xl font-bold text-slate-900 dark:text-slate-100">{tr.empty.title}</h2>
        <p className="max-w-sm text-slate-500 dark:text-slate-400">{tr.empty.description}</p>
        <Button type="button" className="mt-6 rounded-full" variant="secondary" onClick={() => void onRefetch()}>
          {tr.actions.refresh}
        </Button>
      </div>
    );
  }

  const assigned = data.routeStatus === 'assigned';
  const inProgress = data.routeStatus === 'in_progress';

  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 pb-[max(1.5rem,env(safe-area-inset-bottom))] dark:bg-slate-950"
      data-driver-route-loaded
    >
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex items-start justify-between gap-2">
          {overviewHref ? (
            <Link
              href={overviewHref}
              aria-label={dash.backToOverview}
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </Link>
          ) : null}
          <div className={cn('min-w-0', overviewHref && 'flex-1')}>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{tr.headerTitle}</h1>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {tr.progress(data.completedStops, data.totalStops)}
            </p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{tr.scheduled(data.scheduledDate)}</p>
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

        {inProgress ? (
          <div
            className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-900/80"
            role="tablist"
            aria-label={`${tr.viewList} / ${tr.viewMap}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              className={cn(
                'rounded-lg py-2.5 text-sm font-semibold transition-colors',
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
              )}
              onClick={() => setViewMode('list')}
            >
              {tr.viewList}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'map'}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold transition-colors',
                viewMode === 'map'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
              )}
              onClick={() => setViewMode('map')}
            >
              <MapIcon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              {tr.viewMap}
            </button>
          </div>
        ) : null}
      </header>

      {assigned ? (
        <div className="px-4 pt-4">
          <Button
            type="button"
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-slate-900 text-base font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            disabled={isStarting}
            onClick={() => void onStartRoute()}
          >
            {isStarting ? (
              <>
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                {tr.actions.starting}
              </>
            ) : (
              tr.actions.startRoute
            )}
          </Button>
        </div>
      ) : null}

      {inProgress && viewMode === 'map' ? (
        <div className="flex flex-col gap-3 px-4 pt-4">
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{tr.mapHint}</p>
          <ul className="flex flex-col gap-2" aria-label={tr.a11y.timelineList}>
            {data.stops.map((stop) => {
              if (stop.status === 'completed') {
                return (
                  <li
                    key={stop.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-slate-50/95 px-3 py-2 dark:border-slate-600/80 dark:bg-slate-800/80"
                  >
                    <span className="truncate text-slate-600 line-through decoration-slate-500 dark:text-slate-300 dark:decoration-slate-400">
                      {stopHeading(stop, tr)}
                    </span>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                  </li>
                );
              }
              const showMakeNext = canChooseNext && stop.kind === 'property' && stop.status === 'pending';
              return (
                <li
                  key={stop.id}
                  className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{stopHeading(stop, tr)}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{stopAddress(stop, tr)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 w-10 shrink-0 rounded-full p-0"
                      aria-label={tr.a11y.navigate}
                      onClick={() => openMapsQuery(navigateQuery(stop, tr))}
                    >
                      <Navigation size={20} aria-hidden />
                    </Button>
                  </div>
                  {showMakeNext ? (
                    <Button
                      type="button"
                      className="mt-3 w-full rounded-full bg-blue-600 text-white hover:bg-blue-500"
                      disabled={settingNextStopId === stop.id}
                      onClick={() => void handleSetNext(stop.id)}
                    >
                      {settingNextStopId === stop.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {tr.makingNext}
                        </>
                      ) : (
                        tr.makeNextStop
                      )}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
      <div className="relative p-4">
        <div className="absolute bottom-8 left-9 top-8 z-0 w-0.5 bg-slate-200 dark:bg-slate-700" aria-hidden />

        <ol className="relative z-10 space-y-0" aria-label={tr.a11y.timelineList}>
          {data.stops.map((stop, index) => (
            <li key={stop.id} className="relative z-10">
              {stop.status === 'completed' ? (
                <div className="flex gap-4 pb-6 pt-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-slate-50 bg-slate-200 dark:border-slate-900 dark:bg-slate-700">
                    <CheckCircle2 size={18} className="text-slate-500 dark:text-slate-400" aria-hidden />
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-2 pt-2">
                    <h3 className="text-base font-semibold text-slate-600 line-through decoration-slate-500 dark:text-slate-300 dark:decoration-slate-400">
                      {stopHeading(stop, tr)}
                    </h3>
                    {stop.timeTarget ? (
                      <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {stop.timeTarget}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {stop.status === 'active' ? (
                <div className="flex gap-4 pb-6">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-teal-100 bg-teal-500 dark:border-teal-900">
                    <span className="motion-safe:animate-ping absolute h-full w-full rounded-full bg-teal-400 opacity-40" />
                    <MapPin size={18} className="relative text-white" aria-hidden />
                  </div>

                  <div className="flex-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-lg shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="mb-2 inline-block rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                          {stop.kind === 'property' ? tr.statusNextStop : tr.statusActive}
                        </span>
                        <h2 className="text-xl font-bold leading-tight text-slate-900 dark:text-slate-100">
                          {stopHeading(stop, tr)}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{stopAddress(stop, tr)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {stop.kind === 'property' && stop.propertyId ? (
                          <>
                            <button
                              type="button"
                              className={cardActionBtnClass}
                              aria-label={tr.report.voiceAria}
                              title={tr.report.voiceAria}
                              onClick={() =>
                                onVoiceForActiveProperty?.({
                                  propertyId: stop.propertyId!,
                                  label: propertyReportLabel(stop, tr),
                                })
                              }
                            >
                              <Mic className="h-4 w-4" strokeWidth={2.1} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={cardActionBtnClass}
                              aria-label={tr.report.textAria}
                              title={tr.report.textAria}
                              onClick={() =>
                                onTextForActiveProperty?.({
                                  propertyId: stop.propertyId!,
                                  label: propertyReportLabel(stop, tr),
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" strokeWidth={2.1} aria-hidden />
                            </button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          aria-label={tr.a11y.navigate}
                          className="h-10 w-10 shrink-0 rounded-full bg-blue-50 p-0 text-blue-600 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                          onClick={() => openMapsQuery(navigateQuery(stop, tr))}
                        >
                          <Navigation size={20} aria-hidden />
                        </Button>
                      </div>
                    </div>

                    <div className="mb-6 space-y-3">
                      <ItemsGroup
                        title={tr.sections.warehousePick}
                        items={stop.items.filter((i) => i.actionType === 'pickup')}
                        variant="pickup"
                      />
                      <ItemsGroup
                        title={tr.sections.deliver}
                        items={stop.items.filter((i) => i.actionType === 'dropoff')}
                        variant="dropoff"
                      />
                    </div>

                    {stop.kind === 'warehouse' ? (
                      <Button
                        type="button"
                        disabled={pendingCompleteId === stop.id}
                        className="group flex h-14 w-full items-center justify-between rounded-full bg-slate-900 px-2 text-base text-white transition-all hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus-visible:ring-slate-100"
                        onClick={() => void onCompleteStop(stop.id)}
                      >
                        <span className="pl-4 font-semibold">
                          {pendingCompleteId === stop.id ? tr.actions.warehouseCompleting : tr.actions.warehouseComplete}
                        </span>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 transition-colors group-hover:bg-white/30">
                          {pendingCompleteId === stop.id ? (
                            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                          ) : (
                            <ChevronRight size={24} aria-hidden />
                          )}
                        </div>
                      </Button>
                    ) : null}

                    {stop.kind === 'property' ? (
                      <Button
                        type="button"
                        disabled={pendingCompleteId === stop.id}
                        className="group flex h-14 w-full items-center justify-between rounded-full bg-slate-900 px-2 text-base text-white transition-all hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                        onClick={() => void onCompleteStop(stop.id)}
                      >
                        <span className="pl-4 font-semibold">
                          {pendingCompleteId === stop.id ? tr.actions.completing : tr.actions.completeStop}
                        </span>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 transition-colors group-hover:bg-white/30">
                          {pendingCompleteId === stop.id ? (
                            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                          ) : (
                            <ChevronRight size={24} aria-hidden />
                          )}
                        </div>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {stop.status === 'pending' ? (
                <div className="flex gap-4 pb-6 pt-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                    <span className="text-sm font-bold text-slate-400 dark:text-slate-500" aria-hidden>
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    {stop.kind === 'property' && canChooseNext ? (
                      <button
                        type="button"
                        className="w-full rounded-xl border border-transparent text-left transition-colors hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-900/50"
                        onClick={() => setExpandedStopId((id) => (id === stop.id ? null : stop.id))}
                      >
                        <h3 className="pt-2 text-base font-semibold text-slate-600 dark:text-slate-300">
                          {stopHeading(stop, tr)}
                        </h3>
                        {stop.propertyAddress ? (
                          <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-600">{stop.propertyAddress}</p>
                        ) : null}
                        {expandedStopId === stop.id ? (
                          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                            <p className="text-sm text-slate-600 dark:text-slate-400">{stopAddress(stop, tr)}</p>
                            <Button
                              type="button"
                              className="w-full rounded-full bg-blue-600 text-white hover:bg-blue-500"
                              disabled={settingNextStopId === stop.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleSetNext(stop.id);
                              }}
                            >
                              {settingNextStopId === stop.id ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {tr.makingNext}
                                </>
                              ) : (
                                tr.makeNextStop
                              )}
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-teal-600 dark:text-teal-400">{tr.makeNextStop} →</p>
                        )}
                      </button>
                    ) : (
                      <>
                        <h3 className="pt-2 text-base font-semibold text-slate-400 dark:text-slate-500">
                          {stopHeading(stop, tr)}
                        </h3>
                        {stop.kind === 'property' && stop.propertyAddress ? (
                          <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-600">{stop.propertyAddress}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      )}

    </div>
  );
}
