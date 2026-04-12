'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { ChevronDown, ChevronRight, Info, Loader2, Package, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { apiClient } from '@/lib/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useMatchMedia } from '@/hooks/use-match-media';
import { useSupplyMatrix, useSupplyMatrixLineDetail } from '../../hooks/useSupplyMatrix';
import { useSupplyMatrixCollapsedSections } from '../../hooks/useSupplyMatrixCollapsedSections';
import {
  useAssignDeliveryRouteDriver,
  useCreateDeliveryRouteFromPool,
  useDeliveryRouteDetail,
} from '../../hooks/useDeliveryRoutes';
import { DeliveryRouteDetailBody } from './delivery-route-detail-body';
import { usePendingSupplyInterpretations } from '../../hooks/usePendingSupplyInterpretations';
import type { PendingSupplyInterpretationEvent, SupplyMatrixRow } from '../../types';

function cellKey(row: SupplyMatrixRow, propertyId: string): string {
  return `${row.groupKey}|${propertyId}`;
}

function qtyBadgeLabel(
  cell: SupplyMatrixRow['byProperty'][number],
  row: SupplyMatrixRow,
  cellFulfillment: string,
): string {
  if (cellFulfillment === 'delivered' && (cell.quantitySum ?? 0) <= 0 && !cell.quantityIsPartial) {
    return '—';
  }
  if (cell.quantityIsPartial) return '—';
  const u = row.defaultUnit?.trim();
  return u ? `${cell.quantitySum} ${u}` : String(cell.quantitySum);
}

type MatrixCellItem = {
  row: SupplyMatrixRow;
  cell: SupplyMatrixRow['byProperty'][number];
  key: string;
};

type PropertyGroup = {
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string | null;
  items: MatrixCellItem[];
  /** Запросы в разборе ИИ — показываются в карточке этого объекта. */
  pendingLlmEvents?: PendingSupplyInterpretationEvent[];
};

function buildPropertyGroups(rows: SupplyMatrixRow[], locale: string): PropertyGroup[] {
  const map = new Map<string, PropertyGroup>();
  for (const row of rows) {
    const fs = row.fulfillmentStatus ?? 'pending';
    if (fs === 'delivered') continue;
    for (const cell of row.byProperty) {
      const g = map.get(cell.propertyId);
      const item: MatrixCellItem = { row, cell, key: cellKey(row, cell.propertyId) };
      if (g) {
        g.items.push(item);
      } else {
        map.set(cell.propertyId, {
          propertyId: cell.propertyId,
          propertyTitle: cell.propertyTitle,
          propertyAddress: cell.propertyAddress ?? null,
          items: [item],
        });
      }
    }
  }
  for (const g of map.values()) {
    g.items.sort((a, b) =>
      a.row.displayName.localeCompare(b.row.displayName, locale, { sensitivity: 'base' }),
    );
  }
  return [...map.values()].sort((a, b) =>
    a.propertyTitle.localeCompare(b.propertyTitle, locale, { sensitivity: 'base' }),
  );
}

function collectRequestLineIdsFromKeys(keys: Set<string>, rows: SupplyMatrixRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const groupKey = key.slice(0, pipe);
    const propertyId = key.slice(pipe + 1);
    const row = rows.find((r) => r.groupKey === groupKey);
    const cell = row?.byProperty.find((c) => c.propertyId === propertyId);
    if (!cell) continue;
    for (const id of cell.requestLineIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function shortRouteIdForLabel(routeId: string): string {
  return routeId.replace(/-/g, '').slice(0, 8);
}

function truncateMatrixText(text: string, maxLen: number): string {
  const s = text.trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function resolveSupplyEventPropertyId(e: PendingSupplyInterpretationEvent): string | null {
  const pid = e.propertyId?.trim();
  if (pid) return pid;
  if (e.targetType === 'property' && e.targetId?.trim()) return e.targetId.trim();
  return null;
}

/** Добавляет к группам объектов строки «в разборе» по `propertyId` (в т.ч. только что созданные, без строк матрицы). */
function mergeProcessingIntoPropertyGroups(
  baseGroups: PropertyGroup[],
  events: PendingSupplyInterpretationEvent[],
  locale: string,
): PropertyGroup[] {
  const map = new Map<string, PropertyGroup>();
  for (const g of baseGroups) {
    map.set(g.propertyId, { ...g });
  }
  for (const e of events) {
    const pid = resolveSupplyEventPropertyId(e);
    if (!pid) continue;
    const existing = map.get(pid);
    if (existing) {
      const list = existing.pendingLlmEvents ?? [];
      if (!list.some((x) => x.id === e.id)) {
        existing.pendingLlmEvents = [...list, e];
      }
    } else {
      map.set(pid, {
        propertyId: pid,
        propertyTitle: e.propertyTitle?.trim() || pid,
        propertyAddress: null,
        items: [],
        pendingLlmEvents: [e],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.propertyTitle.localeCompare(b.propertyTitle, locale, { sensitivity: 'base' }),
  );
}

function MatrixLlmProcessingEmbeddedRow({
  event,
  t,
}: {
  event: PendingSupplyInterpretationEvent;
  t: (key: string) => string;
}) {
  return (
    <div
      className="flex gap-3 rounded-lg border border-[#008CA4]/30 bg-white/70 px-3 py-2.5 dark:border-[#00d4ff]/25 dark:bg-slate-950/50"
      aria-label={t('matrixProcessingSectionTitle')}
    >
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#008CA4] dark:text-[#5eead4]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 dark:text-slate-100">{truncateMatrixText(event.textRaw, 220)}</p>
        {event.llmIntent?.trim() ? (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{event.llmIntent.trim()}</p>
        ) : null}
        <p className="mt-1 text-xs font-medium text-[#008CA4] dark:text-[#7ee8ff]">{t('matrixProcessingStatus')}</p>
      </div>
    </div>
  );
}

/** Статус строки для бейджа и секций: пул / один маршрут / смешано. */
function routeHandoffKind(row: SupplyMatrixRow): 'pool' | 'on_route' | 'mixed' {
  if (row.deliveryRouteHandoffMixed) return 'mixed';
  if (row.deliveryRouteIdForHandoff) return 'on_route';
  return 'pool';
}

export function ManagerSupplyMatrixView() {
  const t = useTranslations('tasks.managerSupply');
  const isMdUp = useMatchMedia('(min-width: 768px)');
  const locale = useLocale();
  const dateLocale = locale === 'ru' ? ru : enUS;

  const { data: interpretationEvents = [] } = usePendingSupplyInterpretations();
  const llmProcessingSupply = useMemo(
    () =>
      interpretationEvents.filter(
        (e: PendingSupplyInterpretationEvent) =>
          e.managerBucket === 'supply' &&
          (e.workflowState === 'pending_llm' || e.llmStatus === 'processing'),
      ),
    [interpretationEvents],
  );

  const { data: rows, isLoading, isError, refetch } = useSupplyMatrix();
  const createRouteMutation = useCreateDeliveryRouteFromPool();
  const assignDriverMutation = useAssignDeliveryRouteDriver();
  const createRoutePending = createRouteMutation.isPending;
  const assignPending = assignDriverMutation.isPending;
  const { data: staffMembers } = useQuery({
    queryKey: ['users', 'staff-handoff'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: Array<{ id: string; displayName: string; role: string }> }>(
        '/users/staff',
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffDriverId, setHandoffDriverId] = useState('');
  const handoffBusy = createRoutePending || assignPending;

  const [routeDetailSheetId, setRouteDetailSheetId] = useState<string | null>(null);
  const { data: routeDetailData, isFetching: routeDetailLoading } = useDeliveryRouteDetail(
    routeDetailSheetId,
    Boolean(routeDetailSheetId),
  );

  /** Выбор по паре (номенклатура × объект). */
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(new Set());
  const [drawerLineIds, setDrawerLineIds] = useState<string[] | null>(null);
  const { data: detailLines, isFetching: detailLoading } = useSupplyMatrixLineDetail(
    drawerLineIds,
    Boolean(drawerLineIds?.length),
  );

  const sortedRows = useMemo(() => {
    if (!rows?.length) return [];
    return [...rows].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, locale, { sensitivity: 'base' }),
    );
  }, [rows, locale]);

  const propertyGroups = useMemo(() => buildPropertyGroups(sortedRows, locale), [sortedRows, locale]);

  const { collapsedById, setCollapsed } = useSupplyMatrixCollapsedSections();

  const { poolRows, mixedRows, routeSectionList } = useMemo(() => {
    const active = sortedRows.filter((r) => (r.fulfillmentStatus ?? 'pending') !== 'delivered');
    const pool: SupplyMatrixRow[] = [];
    const mixed: SupplyMatrixRow[] = [];
    const onRouteMap = new Map<string, SupplyMatrixRow[]>();
    for (const r of active) {
      if (r.deliveryRouteHandoffMixed) mixed.push(r);
      else if (r.deliveryRouteIdForHandoff) {
        const id = r.deliveryRouteIdForHandoff;
        const arr = onRouteMap.get(id) ?? [];
        arr.push(r);
        onRouteMap.set(id, arr);
      } else pool.push(r);
    }
    const routeSectionList = [...onRouteMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([routeId, rows]) => ({
        routeId,
        rowCount: rows.length,
        groups: buildPropertyGroups(rows, locale),
      }));
    return { poolRows: pool, mixedRows: mixed, routeSectionList };
  }, [sortedRows, locale]);

  const poolGroups = useMemo(() => buildPropertyGroups(poolRows, locale), [poolRows, locale]);
  const poolGroupsWithProcessing = useMemo(
    () => mergeProcessingIntoPropertyGroups(poolGroups, llmProcessingSupply, locale),
    [poolGroups, llmProcessingSupply, locale],
  );
  /** Когда матрица пуста, но есть события `pending_llm` с привязкой к объекту — показываем «В пуле» только с блоками обработки. */
  const poolOnlyProcessing = useMemo(
    () => mergeProcessingIntoPropertyGroups([], llmProcessingSupply, locale),
    [llmProcessingSupply, locale],
  );
  const mixedGroups = useMemo(() => buildPropertyGroups(mixedRows, locale), [mixedRows, locale]);

  const allSelectableCellKeys = useMemo(() => {
    const keys: string[] = [];
    for (const g of propertyGroups) {
      for (const it of g.items) {
        keys.push(it.key);
      }
    }
    return keys;
  }, [propertyGroups]);

  const hasHandoffSelection = selectedCellKeys.size > 0;

  const handoffSelectedMatrixRows = useMemo((): SupplyMatrixRow[] => {
    const seen = new Set<string>();
    const out: SupplyMatrixRow[] = [];
    for (const key of selectedCellKeys) {
      const pipe = key.indexOf('|');
      if (pipe < 0) continue;
      const groupKey = key.slice(0, pipe);
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const row = sortedRows.find((r) => r.groupKey === groupKey);
      if (row) out.push(row);
    }
    return out;
  }, [selectedCellKeys, sortedRows]);

  const requestLineIdsForSelection = useMemo(
    () => collectRequestLineIdsFromKeys(selectedCellKeys, sortedRows),
    [selectedCellKeys, sortedRows],
  );

  const toggleCell = (key: string) => {
    setSelectedCellKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const toggleGroupKeys = (keys: string[]) => {
    const allOn = keys.length > 0 && keys.every((k) => selectedCellKeys.has(k));
    setSelectedCellKeys((prev) => {
      const n = new Set(prev);
      if (allOn) {
        keys.forEach((k) => n.delete(k));
      } else {
        keys.forEach((k) => n.add(k));
      }
      return n;
    });
  };

  const selectAllToggle = () => {
    if (!allSelectableCellKeys.length) return;
    const allOn = allSelectableCellKeys.every((k) => selectedCellKeys.has(k));
    if (allOn) {
      setSelectedCellKeys(new Set());
    } else {
      setSelectedCellKeys(new Set(allSelectableCellKeys));
    }
  };

  const openHandoffSheet = () => {
    if (!requestLineIdsForSelection.length) {
      toast.message(t('matrixHandoffNeedSelection'));
      return;
    }
    setHandoffDriverId('');
    setHandoffOpen(true);
  };

  const confirmHandoffToDriver = async () => {
    if (!requestLineIdsForSelection.length) {
      toast.message(t('matrixHandoffNeedSelection'));
      return;
    }
    if (!handoffDriverId.trim()) {
      toast.message(t('matrixHandoffNeedDriver'));
      return;
    }
    if (handoffSelectedMatrixRows.some((r) => r.deliveryRouteHandoffMixed)) {
      toast.message(t('matrixHandoffMixedRoutes'));
      return;
    }
    const routeIds = new Set(
      handoffSelectedMatrixRows
        .map((r) => r.deliveryRouteIdForHandoff)
        .filter((id): id is string => Boolean(id)),
    );
    if (routeIds.size > 1) {
      toast.message(t('matrixHandoffMultipleRoutes'));
      return;
    }
    const existingRouteId = routeIds.size === 1 ? [...routeIds][0]! : null;

    try {
      if (existingRouteId) {
        await assignDriverMutation.mutateAsync({
          routeId: existingRouteId,
          driverUserId: handoffDriverId.trim(),
        });
        toast.success(t('matrixHandoffSuccessDriverReassigned'));
      } else {
        const { routeId } = await createRouteMutation.mutateAsync({
          requestLineIds: requestLineIdsForSelection,
        });
        await assignDriverMutation.mutateAsync({ routeId, driverUserId: handoffDriverId.trim() });
        toast.success(t('matrixHandoffSuccessWithDriver'));
      }
      setHandoffOpen(false);
      setHandoffDriverId('');
      setSelectedCellKeys(new Set());
    } catch {
      toast.error(t('matrixHandoffError'));
    }
  };

  const onBuildRoute = () => {
    if (!requestLineIdsForSelection.length) {
      toast.message(t('matrixRouteNeedSelection'));
      return;
    }
    createRouteMutation.mutate(
      { requestLineIds: requestLineIdsForSelection },
      {
        onSuccess: () => {
          toast.success(t('matrixRouteSuccess'));
          setSelectedCellKeys(new Set());
        },
        onError: () => toast.error(t('matrixRouteError')),
      },
    );
  };

  const matrixCellFulfillmentLabel = (status: string) => {
    if (status === 'delivered') return t('matrixFulfillmentDelivered');
    if (status === 'in_delivery') return t('matrixFulfillmentInDelivery');
    return t('matrixFulfillmentPending');
  };

  const renderPropertyGroupsBlock = (groups: PropertyGroup[]) =>
    groups.map((group) => {
      const groupKeys = group.items.map((it) => it.key);
      const selectedInGroup = groupKeys.filter((k) => selectedCellKeys.has(k)).length;
      const groupSelectState: boolean | 'indeterminate' =
        groupKeys.length === 0
          ? false
          : selectedInGroup === groupKeys.length
            ? true
            : selectedInGroup > 0
              ? 'indeterminate'
              : false;

      return (
        <section
          key={group.propertyId}
          className="overflow-hidden rounded-xl bg-slate-50/90 dark:bg-slate-900/40"
        >
          <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200/80 bg-slate-50/95 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95">
            {groupKeys.length > 0 ? (
              <Checkbox
                className="mt-0.5"
                checked={groupSelectState}
                onCheckedChange={() => toggleGroupKeys(groupKeys)}
                aria-label={t('matrixGroupSelectAria', { name: group.propertyTitle })}
              />
            ) : (
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{group.propertyTitle}</p>
              {group.propertyAddress ? (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{group.propertyAddress}</p>
              ) : null}
            </div>
          </div>
          {group.pendingLlmEvents && group.pendingLlmEvents.length > 0 ? (
            <div className="space-y-2 border-b border-[#008CA4]/25 bg-[#008CA4]/[0.05] px-4 py-3 dark:border-[#00d4ff]/15 dark:bg-[#00d4ff]/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#006b7d] dark:text-[#a5f3fc]">
                {t('matrixProcessingSectionTitle')}
              </p>
              <div className="space-y-2">
                {group.pendingLlmEvents.map((ev) => (
                  <MatrixLlmProcessingEmbeddedRow key={ev.id} event={ev} t={t} />
                ))}
              </div>
            </div>
          ) : null}
          <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-slate-950/30">
            {group.items.map(({ row, cell, key }) => {
              const fs = cell.fulfillmentStatus ?? row.fulfillmentStatus ?? 'pending';
              const isCatalog = Boolean(row.supplyItemId);
              const checked = selectedCellKeys.has(key);
              const rk = routeHandoffKind(row);
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  className="group flex flex-col gap-2 px-3 py-3 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 sm:px-4 dark:hover:bg-slate-900/50"
                  onClick={() => setDrawerLineIds(cell.requestLineIds)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDrawerLineIds(cell.requestLineIds);
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={() => toggleCell(key)}
                        aria-label={t('matrixCellCheckboxAria', {
                          item: row.displayName,
                          place: group.propertyTitle,
                        })}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{row.displayName}</span>
                        <Badge
                          variant="secondary"
                          className="border-0 bg-slate-100 px-2 py-0.5 font-mono text-xs font-normal text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {qtyBadgeLabel(cell, row, fs)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-semibold',
                            rk === 'pool' && 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400',
                            rk === 'on_route' &&
                              'border-[#008CA4]/55 text-[#006b7d] dark:border-[#00d4ff]/40 dark:text-[#7ee8ff]',
                            rk === 'mixed' && 'border-amber-400/90 text-amber-900 dark:border-amber-500/70 dark:text-amber-200',
                          )}
                        >
                          {rk === 'pool'
                            ? t('matrixRouteStatusPool')
                            : rk === 'on_route'
                              ? t('matrixRouteStatusOnRoute')
                              : t('matrixRouteStatusMixed')}
                        </Badge>
                      </div>
                      {(row.sourceEventCount ?? 1) > 1 ? (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                          {t('matrixSourceEvents', { count: row.sourceEventCount })}
                        </p>
                      ) : null}
                      {!isCatalog ? (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('matrixNoCatalogMatch')}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:pl-2">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'border-0 text-[10px] font-semibold',
                        fs === 'pending' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
                        fs === 'in_delivery' && 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
                        fs === 'delivered' && 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
                      )}
                    >
                      {matrixCellFulfillmentLabel(fs)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      );
    });

  /** Пока ИИ обрабатывает запрос, строки уже есть в ленте — не прячем сводку целиком скелетоном. */
  if (isLoading && llmProcessingSupply.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 text-sm text-destructive">
        {t('matrixLoadError')}{' '}
        <button type="button" className="underline" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Sticky action bar */}
        <div className="sticky top-0 z-20 shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!hasHandoffSelection || handoffBusy}
                className={cn(
                  'gap-1.5 transition-colors',
                  hasHandoffSelection &&
                    'bg-[#008CA4] text-white hover:bg-[#007a90] dark:bg-[#00a8c4] dark:hover:bg-[#0090a8]',
                )}
                variant={hasHandoffSelection ? 'default' : 'secondary'}
                onClick={() => openHandoffSheet()}
              >
                {handoffBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                {t('matrixHandoff')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={hasHandoffSelection ? 'default' : 'secondary'}
                disabled={!hasHandoffSelection || handoffBusy}
                className={cn(
                  'gap-1.5 transition-colors',
                  hasHandoffSelection &&
                    'bg-[#008CA4] text-white hover:bg-[#007a90] dark:bg-[#00a8c4] dark:hover:bg-[#0090a8]',
                )}
                onClick={() => onBuildRoute()}
              >
                {handoffBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                {t('matrixBuildRoute')}
              </Button>
              {allSelectableCellKeys.length > 0 ? (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  onClick={selectAllToggle}
                >
                  {allSelectableCellKeys.every((k) => selectedCellKeys.has(k))
                    ? t('matrixDeselectAll')
                    : t('matrixSelectAll')}
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={t('matrixAggregationHint')}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                  {t('matrixAggregationHint')}
                </TooltipContent>
              </Tooltip>
              <span className="hidden max-w-[min(24rem,40vw)] truncate sm:inline" title={t('matrixSectionOverviewHint')}>
                {t('matrixSectionOverviewHint')}
              </span>
            </div>
          </div>
        </div>

        {!propertyGroups.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4 [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              {poolOnlyProcessing.length > 0 ? (
                <>
                  <Collapsible
                    open={collapsedById['supply-pool'] !== true}
                    onOpenChange={(open) => setCollapsed('supply-pool', !open)}
                  >
                    <section
                      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-900/35"
                      aria-label={t('matrixSectionPoolTitle')}
                    >
                      <CollapsibleTrigger
                        className={cn(
                          'flex w-full min-w-0 items-start gap-2 border-b border-slate-200/70 bg-slate-50/95 px-3 py-2.5 text-left transition-colors dark:border-slate-700/60 dark:bg-slate-900/90',
                          'hover:bg-slate-200/50 dark:hover:bg-white/[0.05]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        <ChevronDown
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                            collapsedById['supply-pool'] === true && '-rotate-90',
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                              {t('matrixSectionPoolTitle')}
                            </h2>
                            <span
                              className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-slate-100/90 px-1.5 text-[10px] font-semibold tabular-nums leading-none text-slate-600 dark:border-slate-600/70 dark:bg-slate-800/80 dark:text-slate-400"
                              aria-label={t('matrixSectionCountLines', { count: poolRows.length })}
                            >
                              {poolRows.length}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionPoolHint')}</p>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="flex flex-col gap-4 px-3 pb-3 pt-3">{renderPropertyGroupsBlock(poolOnlyProcessing)}</div>
                      </CollapsibleContent>
                    </section>
                  </Collapsible>
                  {isLoading ? (
                    <p className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      {t('matrixLoadingSummary')}
                    </p>
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                      {t('matrixPendingLlmHint')}
                    </p>
                  )}
                </>
              ) : llmProcessingSupply.length > 0 ? (
                isLoading ? (
                  <p className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    {t('matrixLoadingSummary')}
                  </p>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                    {t('matrixPendingLlmHint')}
                  </p>
                )
              ) : (
                <p className="rounded-lg bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  {t('matrixEmpty')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4 [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              {poolGroupsWithProcessing.length > 0 ? (
                <Collapsible
                  open={collapsedById['supply-pool'] !== true}
                  onOpenChange={(open) => setCollapsed('supply-pool', !open)}
                >
                  <section
                    className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-900/35"
                    aria-label={t('matrixSectionPoolTitle')}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full min-w-0 items-start gap-2 border-b border-slate-200/70 bg-slate-50/95 px-3 py-2.5 text-left transition-colors dark:border-slate-700/60 dark:bg-slate-900/90',
                        'hover:bg-slate-200/50 dark:hover:bg-white/[0.05]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                          collapsedById['supply-pool'] === true && '-rotate-90',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                            {t('matrixSectionPoolTitle')}
                          </h2>
                          <span
                            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-slate-100/90 px-1.5 text-[10px] font-semibold tabular-nums leading-none text-slate-600 dark:border-slate-600/70 dark:bg-slate-800/80 dark:text-slate-400"
                            aria-label={t('matrixSectionCountLines', { count: poolRows.length })}
                          >
                            {poolRows.length}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionPoolHint')}</p>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-4 px-3 pb-3 pt-3">
                        {renderPropertyGroupsBlock(poolGroupsWithProcessing)}
                      </div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              ) : null}

              {routeSectionList.length > 0 ? (
                <Collapsible
                  open={collapsedById['supply-on-route'] !== true}
                  onOpenChange={(open) => setCollapsed('supply-on-route', !open)}
                >
                  <section
                    className="overflow-hidden rounded-2xl border border-[#008CA4]/25 bg-white shadow-sm dark:border-[#00d4ff]/20 dark:bg-slate-900/35"
                    aria-label={t('matrixSectionOnRouteTitle')}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full min-w-0 items-start gap-2 border-b border-[#008CA4]/15 bg-[#008CA4]/[0.06] px-3 py-2.5 text-left transition-colors dark:border-[#00d4ff]/10 dark:bg-[#00d4ff]/[0.06]',
                        'hover:bg-[#008CA4]/10 dark:hover:bg-[#00d4ff]/10',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 text-[#008CA4] transition-transform duration-200 dark:text-[#7ee8ff]',
                          collapsedById['supply-on-route'] === true && '-rotate-90',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                            {t('matrixSectionOnRouteTitle')}
                          </h2>
                          <span
                            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#008CA4]/15 px-1.5 text-[10px] font-semibold tabular-nums leading-none text-[#006b7d] dark:bg-[#00d4ff]/15 dark:text-[#7ee8ff]"
                            aria-label={t('matrixSectionCountRoutes', { count: routeSectionList.length })}
                          >
                            {routeSectionList.length}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionOnRouteHint')}</p>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-3 px-3 pb-3 pt-3">
                        {routeSectionList.map(({ routeId, rowCount, groups }) => (
                          <Collapsible
                            key={routeId}
                            open={collapsedById[`supply-route-${routeId}`] !== true}
                            onOpenChange={(open) => setCollapsed(`supply-route-${routeId}`, !open)}
                          >
                            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50 dark:border-slate-700/60 dark:bg-slate-950/40">
                              <CollapsibleTrigger
                                className={cn(
                                  'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                                  'hover:bg-slate-100/90 dark:hover:bg-white/[0.05]',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                )}
                              >
                                <ChevronDown
                                  className={cn(
                                    'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                                    collapsedById[`supply-route-${routeId}`] === true && '-rotate-90',
                                  )}
                                  aria-hidden
                                />
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-foreground">
                                    {t('matrixSectionRouteSubgroupTitle', {
                                      shortId: shortRouteIdForLabel(routeId),
                                    })}
                                  </span>
                                  <span className="ml-2 text-[11px] text-muted-foreground">
                                    {t('matrixSectionRouteLineCount', { count: rowCount })}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="shrink-0 rounded-md p-1.5 text-[#008CA4] transition hover:bg-[#008CA4]/10 dark:text-[#7ee8ff] dark:hover:bg-[#00d4ff]/10"
                                  aria-label={t('matrixRouteOpenDetailAria')}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRouteDetailSheetId(routeId);
                                  }}
                                >
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="flex flex-col gap-4 border-t border-slate-200/70 px-3 pb-3 pt-3 dark:border-slate-700/60">
                                  {groups.length ? (
                                    renderPropertyGroupsBlock(groups)
                                  ) : (
                                    <p className="text-center text-xs text-muted-foreground">{t('matrixSectionEmpty')}</p>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              ) : null}

              {mixedGroups.length > 0 ? (
                <Collapsible
                  open={collapsedById['supply-mixed'] !== true}
                  onOpenChange={(open) => setCollapsed('supply-mixed', !open)}
                >
                  <section
                    className="overflow-hidden rounded-2xl border border-amber-300/70 bg-white shadow-sm dark:border-amber-600/45 dark:bg-slate-900/35"
                    aria-label={t('matrixSectionMixedTitle')}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full min-w-0 items-start gap-2 border-b border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-left transition-colors dark:border-amber-900/40 dark:bg-amber-950/35',
                        'hover:bg-amber-100/90 dark:hover:bg-amber-950/50',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 text-amber-700 transition-transform duration-200 dark:text-amber-400',
                          collapsedById['supply-mixed'] === true && '-rotate-90',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                            {t('matrixSectionMixedTitle')}
                          </h2>
                          <span
                            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold tabular-nums leading-none text-amber-900 dark:text-amber-200"
                            aria-label={t('matrixSectionCountLines', { count: mixedRows.length })}
                          >
                            {mixedRows.length}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionMixedHint')}</p>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-4 px-3 pb-3 pt-3">{renderPropertyGroupsBlock(mixedGroups)}</div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              ) : null}
            </div>
          </div>
        )}

        <Sheet open={handoffOpen} onOpenChange={setHandoffOpen}>
          <SheetContent
            title={t('matrixHandoffSheetTitle')}
            description={t('matrixHandoffSheetHint')}
            footer={
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setHandoffOpen(false)}>
                  {t('matrixHandoffSheetCancel')}
                </Button>
                <Button
                  type="button"
                  className="w-full bg-[#008CA4] text-white hover:bg-[#007a90] sm:w-auto"
                  disabled={handoffBusy || !handoffDriverId}
                  onClick={() => void confirmHandoffToDriver()}
                >
                  {handoffBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('matrixHandoffSheetConfirm')}
                </Button>
              </div>
            }
          >
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('matrixHandoffDriverLabel')}</span>
                <Select
                  className="w-full"
                  value={handoffDriverId}
                  onChange={(e) => setHandoffDriverId(e.target.value)}
                  aria-label={t('matrixHandoffDriverLabel')}
                >
                  <option value="">{t('matrixHandoffDriverPlaceholder')}</option>
                  {(staffMembers ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.role})
                    </option>
                  ))}
                </Select>
              </label>
              <p className="text-[11px] leading-snug text-muted-foreground">{t('matrixHandoffSheetNote')}</p>
            </div>
          </SheetContent>
        </Sheet>

        <Drawer open={Boolean(drawerLineIds?.length)} onOpenChange={(o) => !o && setDrawerLineIds(null)}>
          <DrawerContent title={t('matrixCellDetailTitle')} description={t('matrixCellDetailHint')}>
            <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto px-4 pb-6 pt-2">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-[#008CA4]" />
                </div>
              ) : (
                (detailLines ?? []).map((line) => (
                  <blockquote
                    key={line.requestLineId}
                    className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm"
                  >
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(line.createdAt), 'PPp', { locale: dateLocale })} · {line.authorName || '—'}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-foreground">{line.textRaw}</p>
                    {(line.quantity || line.unit) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('itemsHeading')}: {line.llmRawName ?? '—'} · {[line.quantity, line.unit].filter(Boolean).join(' ')}
                      </p>
                    )}
                  </blockquote>
                ))
              )}
            </div>
          </DrawerContent>
        </Drawer>

        {isMdUp ? (
          <Sheet open={routeDetailSheetId !== null} onOpenChange={(o) => !o && setRouteDetailSheetId(null)}>
            <SheetContent title={t('deliveryRouteDetailTitle')} description={t('deliveryRouteDetailHint')}>
              <div className="space-y-4">
                <DeliveryRouteDetailBody
                  detail={routeDetailData}
                  detailLoading={routeDetailLoading}
                  emptyLabel={t('deliveryRouteDetailEmpty')}
                  t={t as (key: string) => string}
                />
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer open={routeDetailSheetId !== null} onOpenChange={(o) => !o && setRouteDetailSheetId(null)}>
            <DrawerContent title={t('deliveryRouteDetailTitle')} description={t('deliveryRouteDetailHint')}>
              <div className="max-h-[min(70vh,520px)] space-y-4 overflow-y-auto">
                <DeliveryRouteDetailBody
                  detail={routeDetailData}
                  detailLoading={routeDetailLoading}
                  emptyLabel={t('deliveryRouteDetailEmpty')}
                  t={t as (key: string) => string}
                />
              </div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    </TooltipProvider>
  );
}
