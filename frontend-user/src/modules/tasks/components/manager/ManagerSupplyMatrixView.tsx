'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { format, parseISO } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/error-message';
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
  useDisbandDeliveryRoute,
} from '../../hooks/useDeliveryRoutes';
import { DeliveryRouteDetailBody } from './delivery-route-detail-body';
import { ManagerSupplyDeliveryRoutesSection } from './ManagerSupplyDeliveryRoutesSection';
import { usePendingSupplyInterpretations } from '../../hooks/usePendingSupplyInterpretations';
import type { PendingSupplyInterpretationEvent, SupplyMatrixRow } from '../../types';

/** Portaled modal — same teal primary as task detail / matrix actions (not global blue). */
const ROUTE_REASSIGN_PORTAL_STYLE = {
  '--primary': 'var(--task-detail-accent)',
  '--primary-foreground': 'var(--task-detail-accent-fg)',
  '--ring': 'var(--task-detail-accent)',
} as CSSProperties;

function cellKey(row: SupplyMatrixRow, propertyId: string): string {
  return `${row.groupKey}|${propertyId}`;
}

/** Кол-во для бейджа; `null` — не показывать (нет числа / нечего выводить вместо «—»). */
function qtyBadgeLabel(
  cell: SupplyMatrixRow['byProperty'][number],
  row: SupplyMatrixRow,
  cellFulfillment: string,
): string | null {
  if (cellFulfillment === 'delivered' && (cell.quantitySum ?? 0) <= 0 && !cell.quantityIsPartial) {
    return null;
  }
  if (cell.quantityIsPartial) return null;
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
      className="flex gap-3 rounded-lg border border-primary/30 bg-card/80 px-3 py-2.5 dark:border-primary/25 dark:bg-card/50"
      aria-label={t('matrixProcessingSectionTitle')}
    >
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{truncateMatrixText(event.textRaw, 220)}</p>
        {event.llmIntent?.trim() ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{event.llmIntent.trim()}</p>
        ) : null}
        <p className="mt-1 text-xs font-medium text-primary">{t('matrixProcessingStatus')}</p>
      </div>
    </div>
  );
}

export function ManagerSupplyMatrixView({
  toolbarPortalHost,
}: {
  /** Если задан — «Передать водителю» рендерится в панели рядом с «Добавить довоз». */
  toolbarPortalHost?: HTMLElement | null;
} = {}) {
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
  const { data: routeDetailData, isFetching: routeDetailFetching } = useDeliveryRouteDetail(
    routeDetailSheetId,
    Boolean(routeDetailSheetId),
  );
  /** Не крутить лист при фоновом refetch — только пока нет данных (после смены ключа спиннер ок). */
  const routeDetailBodyLoading = Boolean(routeDetailSheetId) && routeDetailFetching && !routeDetailData;

  const routeSheetHeaderDate = useMemo(() => {
    const d = routeDetailData?.scheduledDate;
    if (!d) return null;
    try {
      return format(parseISO(`${d}T12:00:00`), 'd MMMM yyyy', { locale: dateLocale });
    } catch {
      return d;
    }
  }, [routeDetailData?.scheduledDate, dateLocale]);

  const routeSheetHeaderActions =
    routeSheetHeaderDate != null ? (
      <span className="max-w-[11rem] truncate text-right text-[11px] font-normal leading-tight text-muted-foreground/75">
        {routeSheetHeaderDate}
      </span>
    ) : null;

  const [routeReassignOpen, setRouteReassignOpen] = useState(false);
  const [reassignDriverId, setReassignDriverId] = useState('');
  const [routeDisbandConfirmOpen, setRouteDisbandConfirmOpen] = useState(false);

  const { mutate: disbandRouteMutation, isPending: disbandRoutePending } = useDisbandDeliveryRoute();

  const openRouteReassign = useCallback(() => {
    setReassignDriverId(routeDetailData?.driverUserId ?? '');
    setRouteReassignOpen(true);
  }, [routeDetailData?.driverUserId]);

  const routeDetailHeaderAdornment = useMemo(() => {
    if (!routeDetailData || routeDetailBodyLoading) return null;
    const canReassign = routeDetailData.status !== 'completed' && routeDetailData.status !== 'cancelled';
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{t('deliveryRouteResponsibleLabel')}</span>
        <span className="text-sm font-medium text-foreground">
          {routeDetailData.driverName?.trim() || t('deliveryRouteNoDriver')}
        </span>
        {canReassign ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-7 w-7 shrink-0"
            onClick={openRouteReassign}
            aria-label={t('deliveryRouteReassignTitle')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }, [routeDetailData, routeDetailBodyLoading, t, openRouteReassign]);

  const routeDisbandPanelBlock = useMemo(() => {
    if (
      !routeDetailData ||
      (routeDetailData.status !== 'draft' && routeDetailData.status !== 'assigned')
    ) {
      return null;
    }
    return (
      <div className="border-t border-border/60 pt-4">
        <Button
          type="button"
          variant="outline"
          className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
          onClick={() => setRouteDisbandConfirmOpen(true)}
        >
          {t('deliveryRouteDisbandMenuItem')}
        </Button>
      </div>
    );
  }, [routeDetailData, t]);

  const confirmRouteReassign = () => {
    if (!routeDetailSheetId || !reassignDriverId.trim()) {
      toast.message(t('deliveryRouteAssignNeedDriver'));
      return;
    }
    assignDriverMutation.mutate(
      {
        routeId: routeDetailSheetId,
        driverUserId: reassignDriverId.trim(),
        allowReassignWhileActive: routeDetailData?.status === 'in_progress',
      },
      {
        onSuccess: () => {
          toast.success(t('deliveryRouteReassignSuccess'));
          setRouteReassignOpen(false);
        },
        onError: () => toast.error(t('deliveryRouteAssignError')),
      },
    );
  };

  /** Выбор по паре (номенклатура × объект). */
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(new Set());
  const [drawerLineIds, setDrawerLineIds] = useState<string[] | null>(null);
  const { data: detailLines, isFetching: detailLoading } = useSupplyMatrixLineDetail(
    drawerLineIds,
    Boolean(drawerLineIds?.length),
  );
  /** Пока нет ответа — спиннер; пустой массив — не крутить при refetch. */
  const matrixCellDetailBodyLoading = Boolean(drawerLineIds?.length) && detailLoading && detailLines === undefined;

  const sortedRows = useMemo(() => {
    if (!rows?.length) return [];
    return [...rows].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, locale, { sensitivity: 'base' }),
    );
  }, [rows, locale]);

  const propertyGroups = useMemo(() => buildPropertyGroups(sortedRows, locale), [sortedRows, locale]);

  const { collapsedById, setCollapsed } = useSupplyMatrixCollapsedSections();

  const { poolRows, mixedRows } = useMemo(() => {
    const active = sortedRows.filter((r) => (r.fulfillmentStatus ?? 'pending') !== 'delivered');
    const pool: SupplyMatrixRow[] = [];
    const mixed: SupplyMatrixRow[] = [];
    for (const r of active) {
      if (r.deliveryRouteHandoffMixed) mixed.push(r);
      else if (!r.deliveryRouteIdForHandoff) pool.push(r);
    }
    return { poolRows: pool, mixedRows: mixed };
  }, [sortedRows]);

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
  /** Секция «В пуле» есть в разметке — «Выбрать всё» в заголовке пула; иначе (только смешанное) — в заголовке смешанного блока. */
  const poolSectionRendered =
    (!propertyGroups.length && poolOnlyProcessing.length > 0) ||
    (propertyGroups.length > 0 && poolGroupsWithProcessing.length > 0);
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

  const matrixCellFulfillmentLabel = (status: string) => {
    if (status === 'delivered') return t('matrixFulfillmentDelivered');
    if (status === 'in_delivery') return t('matrixFulfillmentInDelivery');
    return t('matrixFulfillmentPending');
  };

  const renderPropertyGroupsBlock = (groups: PropertyGroup[], routeContextId?: string) =>
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

      const collapsePropKey =
        routeContextId != null ? `supply-onroute-${routeContextId}-prop-${group.propertyId}` : null;
      const inRoute = Boolean(routeContextId && collapsePropKey);

      const llmBlock =
        group.pendingLlmEvents && group.pendingLlmEvents.length > 0 ? (
          <div
            className={cn(
              'space-y-1 border-b border-primary/25 bg-primary/[0.06] dark:border-primary/20 dark:bg-primary/[0.08]',
              inRoute ? 'px-2 py-1.5 sm:py-2' : 'px-2 py-2 sm:px-3 sm:py-2.5',
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              {t('matrixProcessingSectionTitle')}
            </p>
            <div className="space-y-1.5">
              {group.pendingLlmEvents.map((ev) => (
                <MatrixLlmProcessingEmbeddedRow key={ev.id} event={ev} t={t} />
              ))}
            </div>
          </div>
        ) : null;

      const linesBlock = (
        <div
          className={cn(
            'mt-1.5 overflow-hidden rounded-lg border border-border bg-card shadow-sm ring-1 ring-border/30 dark:border-border dark:bg-card/80 dark:shadow-none dark:ring-border/20',
            'mx-1 mb-1 sm:mx-1.5 sm:mt-2 sm:mb-1.5 md:mx-2',
          )}
        >
          <div className="divide-y divide-border/70 dark:divide-border/50">
          {group.items.map(({ row, cell, key }) => {
            const fs = cell.fulfillmentStatus ?? row.fulfillmentStatus ?? 'pending';
            const isCatalog = Boolean(row.supplyItemId);
            const checked = selectedCellKeys.has(key);
            const qtyLabel = qtyBadgeLabel(cell, row, fs);
            const hideCellCheckbox = fs === 'in_delivery' || fs === 'delivered';
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                className="group flex flex-row items-start gap-1.5 px-1.5 py-1 transition-colors hover:bg-muted/50 sm:items-center sm:gap-3 sm:px-3 sm:py-1.5 dark:hover:bg-muted/25"
                onClick={() => setDrawerLineIds(cell.requestLineIds)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDrawerLineIds(cell.requestLineIds);
                  }
                }}
              >
                {hideCellCheckbox ? (
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <div
                    className="pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      className="h-4 w-4 border-foreground/20 [&_svg]:h-3 [&_svg]:w-3"
                      checked={checked}
                      onCheckedChange={() => toggleCell(key)}
                      aria-label={t('matrixCellCheckboxAria', {
                        item: row.displayName,
                        place: group.propertyTitle,
                      })}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="text-[13px] font-medium leading-snug text-foreground sm:text-sm">
                      {row.displayName}
                    </span>
                    {qtyLabel != null ? (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-muted px-1 py-0 font-mono text-[10px] font-normal text-foreground sm:px-1.5 sm:text-[11px] dark:bg-muted/60"
                      >
                        {qtyLabel}
                      </Badge>
                    ) : null}
                  </div>
                  {(row.sourceEventCount ?? 1) > 1 ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
                      {t('matrixSourceEvents', { count: row.sourceEventCount })}
                    </p>
                  ) : null}
                  {!isCatalog ? (
                    <p className="mt-0.5 text-[10px] text-amber-700 sm:text-[11px] dark:text-amber-400">{t('matrixNoCatalogMatch')}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col justify-center self-stretch sm:self-center sm:pl-1">
                  <Badge
                    variant="secondary"
                    className={cn(
                      'whitespace-nowrap border-0 px-1.5 py-0 text-[9px] font-semibold leading-tight sm:text-[10px]',
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
        </div>
      );

      if (inRoute && collapsePropKey) {
        return (
          <Collapsible
            key={group.propertyId}
            open={collapsedById[collapsePropKey] !== true}
            onOpenChange={(open) => setCollapsed(collapsePropKey, !open)}
          >
            <section className="overflow-hidden rounded-lg border border-border bg-muted/30 dark:border-border dark:bg-card/60">
              <CollapsibleTrigger
                className={cn(
                  'flex w-full min-w-0 items-center gap-1.5 border-b border-border bg-muted/40 px-2 py-1.5 text-left transition-colors sm:py-2 dark:bg-muted/20',
                  'hover:bg-muted/55 dark:hover:bg-muted/35',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                    collapsedById[collapsePropKey] !== true && 'rotate-90',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-snug text-foreground sm:text-sm">
                    {group.propertyTitle}
                  </p>
                  {group.propertyAddress ? (
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                      {group.propertyAddress}
                    </p>
                  ) : null}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {llmBlock}
                {linesBlock}
              </CollapsibleContent>
            </section>
          </Collapsible>
        );
      }

      return (
        <section
          key={group.propertyId}
          className="overflow-hidden rounded-lg border border-border bg-muted/30 sm:rounded-xl dark:border-border dark:bg-card/60"
        >
          <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-muted/40 px-2 py-1.5 backdrop-blur-md sm:gap-2 sm:px-3 sm:py-2 dark:bg-muted/20">
            {groupKeys.length > 0 ? (
              <Checkbox
                className="h-4 w-4 shrink-0 border-foreground/20 [&_svg]:h-3 [&_svg]:w-3"
                checked={groupSelectState}
                onCheckedChange={() => toggleGroupKeys(groupKeys)}
                aria-label={t('matrixGroupSelectAria', { name: group.propertyTitle })}
              />
            ) : (
              <span className="inline-flex h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug text-foreground sm:text-sm">
                {group.propertyTitle}
              </p>
              {group.propertyAddress ? (
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                  {group.propertyAddress}
                </p>
              ) : null}
            </div>
          </div>
          {llmBlock}
          {linesBlock}
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

  const matrixToolbar = (
    <Button
      type="button"
      size="sm"
      disabled={!hasHandoffSelection || handoffBusy}
      className="shrink-0 gap-1.5 transition-colors"
      variant={hasHandoffSelection ? 'default' : 'secondary'}
      onClick={() => openHandoffSheet()}
    >
      {handoffBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {t('matrixHandoff')}
    </Button>
  );

  const poolSelectAllControl =
    allSelectableCellKeys.length > 0 ? (
      <button
        type="button"
        className="shrink-0 pt-0.5 text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          selectAllToggle();
        }}
      >
        {allSelectableCellKeys.every((k) => selectedCellKeys.has(k))
          ? t('matrixDeselectAll')
          : t('matrixSelectAll')}
      </button>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbarPortalHost
        ? createPortal(matrixToolbar, toolbarPortalHost)
        : (
            <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-md dark:bg-card/90">
              <div className="mx-auto flex w-full max-w-5xl flex-nowrap items-center gap-3">
                {matrixToolbar}
              </div>
            </div>
          )}

        {!propertyGroups.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4 [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:gap-4">
              {poolOnlyProcessing.length > 0 ? (
                <>
                  <Collapsible
                    open={collapsedById['supply-pool'] !== true}
                    onOpenChange={(open) => setCollapsed('supply-pool', !open)}
                  >
                    <section
                      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:border-border dark:bg-card/80"
                      aria-label={t('matrixSectionPoolTitle')}
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 dark:border-border dark:bg-muted/25">
                        <CollapsibleTrigger
                          className={cn(
                            'flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left transition-colors sm:px-3 sm:py-2.5',
                            'hover:bg-muted/50 dark:hover:bg-muted/25',
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
                                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted px-1.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground"
                                aria-label={t('matrixSectionCountLines', { count: poolRows.length })}
                              >
                                {poolRows.length}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionPoolHint')}</p>
                          </div>
                        </CollapsibleTrigger>
                        {poolSelectAllControl ? (
                          <div className="shrink-0 pr-2 pt-2 sm:pr-3 sm:pt-2.5">{poolSelectAllControl}</div>
                        ) : null}
                      </div>
                      <CollapsibleContent>
                        <div className="flex flex-col gap-2 px-2 pb-2 pt-2 sm:gap-4 sm:px-3 sm:pb-3 sm:pt-3">
                          {renderPropertyGroupsBlock(poolOnlyProcessing)}
                        </div>
                      </CollapsibleContent>
                    </section>
                  </Collapsible>
                  {isLoading ? (
                    <p className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-4 py-6 text-sm text-muted-foreground dark:bg-muted/20">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      {t('matrixLoadingSummary')}
                    </p>
                  ) : (
                    <p className="rounded-lg bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground dark:bg-muted/20">
                      {t('matrixPendingLlmHint')}
                    </p>
                  )}
                </>
              ) : llmProcessingSupply.length > 0 ? (
                isLoading ? (
                  <p className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-4 py-6 text-sm text-muted-foreground dark:bg-muted/20">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    {t('matrixLoadingSummary')}
                  </p>
                ) : (
                  <p className="rounded-lg bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground dark:bg-muted/20">
                    {t('matrixPendingLlmHint')}
                  </p>
                )
              ) : (
                <p className="rounded-lg bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground dark:bg-muted/20">
                  {t('matrixEmpty')}
                </p>
              )}
              <section
                className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm dark:border-border dark:bg-card/80 sm:p-4"
                aria-label={t('routesTab')}
              >
                <ManagerSupplyDeliveryRoutesSection onOpenRouteDetail={setRouteDetailSheetId} />
              </section>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4 [-webkit-overflow-scrolling:touch]">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:gap-4">
              {poolGroupsWithProcessing.length > 0 ? (
                <Collapsible
                  open={collapsedById['supply-pool'] !== true}
                  onOpenChange={(open) => setCollapsed('supply-pool', !open)}
                >
                  <section
                    className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:border-border dark:bg-card/80"
                    aria-label={t('matrixSectionPoolTitle')}
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 dark:border-border dark:bg-muted/25">
                      <CollapsibleTrigger
                        className={cn(
                          'flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left transition-colors sm:px-3 sm:py-2.5',
                          'hover:bg-muted/50 dark:hover:bg-muted/25',
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
                              className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted px-1.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground"
                              aria-label={t('matrixSectionCountLines', { count: poolRows.length })}
                            >
                              {poolRows.length}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('matrixSectionPoolHint')}</p>
                        </div>
                      </CollapsibleTrigger>
                      {poolSelectAllControl ? (
                        <div className="shrink-0 pr-2 pt-2 sm:pr-3 sm:pt-2.5">{poolSelectAllControl}</div>
                      ) : null}
                    </div>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-2 px-2 pb-2 pt-2 sm:gap-4 sm:px-3 sm:pb-3 sm:pt-3">
                        {renderPropertyGroupsBlock(poolGroupsWithProcessing)}
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
                    className="overflow-hidden rounded-2xl border border-amber-300/70 bg-card shadow-sm dark:border-amber-600/45 dark:bg-card/80"
                    aria-label={t('matrixSectionMixedTitle')}
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-amber-200/80 bg-amber-50/90 dark:border-amber-900/40 dark:bg-amber-950/35">
                      <CollapsibleTrigger
                        className={cn(
                          'flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left transition-colors sm:px-3 sm:py-2.5',
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
                      {poolSelectAllControl && !poolSectionRendered ? (
                        <div className="shrink-0 pr-2 pt-2 sm:pr-3 sm:pt-2.5">{poolSelectAllControl}</div>
                      ) : null}
                    </div>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-2 px-2 pb-2 pt-2 sm:gap-4 sm:px-3 sm:pb-3 sm:pt-3">
                        {renderPropertyGroupsBlock(mixedGroups)}
                      </div>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              ) : null}

              <section
                className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm dark:border-border dark:bg-card/80 sm:p-4"
                aria-label={t('routesTab')}
              >
                <ManagerSupplyDeliveryRoutesSection onOpenRouteDetail={setRouteDetailSheetId} />
              </section>
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
                  variant="default"
                  className="w-full sm:w-auto"
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

        {isMdUp ? (
          <Sheet open={Boolean(drawerLineIds?.length)} onOpenChange={(o) => !o && setDrawerLineIds(null)}>
            <SheetContent title={t('matrixCellDetailTitle')} description={t('matrixCellDetailHint')}>
              {matrixCellDetailBodyLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-3">
                  {(detailLines ?? []).map((line) => (
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
                  ))}
                </div>
              )}
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer open={Boolean(drawerLineIds?.length)} onOpenChange={(o) => !o && setDrawerLineIds(null)}>
            <DrawerContent title={t('matrixCellDetailTitle')} description={t('matrixCellDetailHint')}>
              <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto px-4 pb-6 pt-2">
                {matrixCellDetailBodyLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
        )}

        {isMdUp ? (
          <Sheet
            open={routeDetailSheetId !== null}
            onOpenChange={(o) => {
              if (!o) {
                setRouteDetailSheetId(null);
                setRouteDisbandConfirmOpen(false);
              }
            }}
          >
            <SheetContent
              title={t('deliveryRouteDetailTitle')}
              description={t('deliveryRouteDetailHint')}
              headerActions={routeSheetHeaderActions}
              headerAdornment={routeDetailHeaderAdornment}
            >
              <div className="space-y-4">
                <DeliveryRouteDetailBody
                  detail={routeDetailData}
                  detailLoading={routeDetailBodyLoading}
                  emptyLabel={t('deliveryRouteDetailEmpty')}
                  t={t as (key: string) => string}
                />
                {routeDisbandPanelBlock}
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer
            open={routeDetailSheetId !== null}
            onOpenChange={(o) => {
              if (!o) {
                setRouteDetailSheetId(null);
                setRouteDisbandConfirmOpen(false);
              }
            }}
          >
            <DrawerContent
              title={t('deliveryRouteDetailTitle')}
              description={t('deliveryRouteDetailHint')}
              headerActions={routeSheetHeaderActions}
              headerAdornment={routeDetailHeaderAdornment}
            >
              <div className="max-h-[min(70vh,520px)] space-y-4 overflow-y-auto">
                <DeliveryRouteDetailBody
                  detail={routeDetailData}
                  detailLoading={routeDetailBodyLoading}
                  emptyLabel={t('deliveryRouteDetailEmpty')}
                  t={t as (key: string) => string}
                />
                {routeDisbandPanelBlock}
              </div>
            </DrawerContent>
          </Drawer>
        )}

        <Dialog open={routeDisbandConfirmOpen} onOpenChange={setRouteDisbandConfirmOpen}>
          <DialogContent
            title={t('deliveryRouteDisbandConfirmTitle')}
            description={t('deliveryRouteDisbandConfirmHint')}
            stackAboveTaskLayer
            footer={
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRouteDisbandConfirmOpen(false)}>
                  {t('deliveryRouteDisbandCancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={disbandRoutePending || !routeDetailSheetId}
                  onClick={() => {
                    if (!routeDetailSheetId) return;
                    const rid = routeDetailSheetId;
                    disbandRouteMutation(rid, {
                      onSuccess: () => {
                        toast.success(t('deliveryRouteDisbandSuccess'));
                        setRouteDetailSheetId(null);
                        setRouteDisbandConfirmOpen(false);
                      },
                      onError: (err) =>
                        toast.error(getApiErrorMessage(err) ?? t('deliveryRouteDisbandError')),
                    });
                  }}
                >
                  {disbandRoutePending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('deliveryRouteDisbandConfirm')}
                </Button>
              </div>
            }
          >
            <p className="sr-only">{t('deliveryRouteDisbandConfirmTitle')}</p>
          </DialogContent>
        </Dialog>

        <ResponsiveModal
          open={routeReassignOpen}
          onOpenChange={setRouteReassignOpen}
          desktopPresentation="side"
        >
          <ResponsiveModalContent
            title={t('deliveryRouteReassignTitle')}
            description={t('deliveryRouteReassignHint')}
            contentStyle={ROUTE_REASSIGN_PORTAL_STYLE}
            stackAboveTaskLayer
            footer={
              <Button
                type="button"
                className="w-full"
                variant="default"
                disabled={assignPending || !reassignDriverId.trim()}
                onClick={() => confirmRouteReassign()}
              >
                {assignPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('deliveryRouteReassignConfirm')}
              </Button>
            }
          >
            <Select
              className="w-full"
              value={reassignDriverId}
              onChange={(e) => setReassignDriverId(e.target.value)}
              aria-label={t('deliveryRouteAssignPlaceholder')}
            >
              <option value="">{t('deliveryRouteAssignPlaceholder')}</option>
              {(staffMembers ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.role})
                </option>
              ))}
            </Select>
          </ResponsiveModalContent>
        </ResponsiveModal>
      </div>
  );
}
