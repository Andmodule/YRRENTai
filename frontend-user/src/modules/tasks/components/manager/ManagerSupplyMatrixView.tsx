'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { addDays, format, parseISO } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { Calendar, ChevronDown, ChevronRight, Loader2, MapPin, Package, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { useTasksFiltersStore } from '@/stores/tasks-filters.store';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useMatchMedia } from '@/hooks/use-match-media';
import {
  useSupplyMatrix,
  useSupplyMatrixLineDetail,
  useSupplyMatrixRemovePoolLines,
} from '../../hooks/useSupplyMatrix';
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
import { useTasks } from '../../hooks/useTasks';
import { AssigneePickerField } from '../shared/AssigneePickerField';
import type { PendingSupplyInterpretationEvent, StaffMember, SupplyMatrixRow } from '../../types';
import { matrixQtySuffixRedundant, stripTrailingQtyFromMatrixTitle } from '../../utils/matrix-qty-display';
import { parseCatalogUnitOptions } from '@/modules/tasks/utils/supply-catalog-units';

/** Первая опция из справочника («шт|упак.») для бейджа количества. */
function displayMatrixRowUnit(row: Pick<SupplyMatrixRow, 'defaultUnit'>): string | null {
  const raw = row.defaultUnit?.trim();
  if (!raw) return null;
  const opts = parseCatalogUnitOptions(raw);
  return opts[0] ?? null;
}

/** Portaled modal — same teal primary as task detail / matrix actions (not global blue). */
const ROUTE_REASSIGN_PORTAL_STYLE = {
  '--primary': 'var(--task-detail-accent)',
  '--primary-foreground': 'var(--task-detail-accent-fg)',
  '--ring': 'var(--task-detail-accent)',
} as CSSProperties;

/** `yyyy-MM-dd` calendar day, local, relative to today. */
function handoffYmdFromToday(offsetDays: number): string {
  return format(addDays(new Date(), offsetDays), 'yyyy-MM-dd');
}

function cellKey(row: SupplyMatrixRow, propertyId: string): string {
  return `${row.groupKey}|${propertyId}`;
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

function collectHandoffSelectedCells(
  keys: Set<string>,
  rows: SupplyMatrixRow[],
): Array<{ row: SupplyMatrixRow; cell: SupplyMatrixRow['byProperty'][number] }> {
  const out: Array<{ row: SupplyMatrixRow; cell: SupplyMatrixRow['byProperty'][number] }> = [];
  for (const key of keys) {
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const groupKey = key.slice(0, pipe);
    const propertyId = key.slice(pipe + 1);
    const row = rows.find((r) => r.groupKey === groupKey);
    const cell = row?.byProperty.find((c) => c.propertyId === propertyId);
    if (row && cell) out.push({ row, cell });
  }
  return out;
}

type HandoffMatrixPreview = {
  warehouse: Array<{ key: string; name: string; unit: string | null; qtyLabel: string }>;
  byProperty: Array<{
    propertyId: string;
    propertyTitle: string;
    lines: Array<{ key: string; name: string; qtyLabel: string }>;
  }>;
};

/** Одна номенклатура в пуле и на маршруте приходит как две строки матрицы с разным groupKey — для сводно склеиваем по catalog id. */
function handoffMergeKey(row: SupplyMatrixRow): string {
  return row.supplyItemId ? `si:${row.supplyItemId}` : row.groupKey;
}

/** Сумма количества по всем строкам матрицы с тем же слиянием × объект (несколько `groupKey` у одной номенклатуры). */
function mergedQuantitySumForCell(
  row: SupplyMatrixRow,
  cell: SupplyMatrixRow['byProperty'][number],
  scopeRows: SupplyMatrixRow[],
): number {
  const mk = handoffMergeKey(row);
  const pid = cell.propertyId;
  let sum = 0;
  for (const r of scopeRows) {
    if (handoffMergeKey(r) !== mk) continue;
    const c = r.byProperty.find((x) => x.propertyId === pid);
    if (!c) continue;
    const fs = c.fulfillmentStatus ?? r.fulfillmentStatus ?? 'pending';
    if (fs === 'delivered') continue;
    sum += c.quantitySum ?? 0;
  }
  return sum;
}

function mergedSourceEventsCount(
  row: SupplyMatrixRow,
  cell: SupplyMatrixRow['byProperty'][number],
  scopeRows: SupplyMatrixRow[],
): number {
  const mk = handoffMergeKey(row);
  const pid = cell.propertyId;
  let n = 0;
  for (const r of scopeRows) {
    if (handoffMergeKey(r) !== mk) continue;
    if (!r.byProperty.some((c) => c.propertyId === pid)) continue;
    n += r.sourceEventCount ?? 1;
  }
  return Math.max(n, row.sourceEventCount ?? 1);
}

/** Кол-во для бейджа; `null` — не показывать. У частичных строк quantitySum всё равно учитывает строки (+1 без числа в БД). */
function qtyBadgeLabel(
  cell: SupplyMatrixRow['byProperty'][number],
  row: SupplyMatrixRow,
  cellFulfillment: string,
  scopeRows: SupplyMatrixRow[],
): string | null {
  const fromMergedCells = mergedQuantitySumForCell(row, cell, scopeRows);
  /** Одна колонка-объект на строку: `totalQuantity` с бэка иногда надёжнее рассинхрона ячейки; при дублях строк матрицы суммируем ячейки. */
  const aggregated =
    row.byProperty.length === 1
      ? Math.max(fromMergedCells, row.totalQuantity ?? 0)
      : fromMergedCells;
  if (cellFulfillment === 'delivered' && aggregated <= 0 && !cell.quantityIsPartial) {
    return null;
  }
  if (aggregated <= 0) return null;
  const mk = handoffMergeKey(row);
  const unitRow =
    scopeRows.find((r) => handoffMergeKey(r) === mk && displayMatrixRowUnit(r)) ?? row;
  const u = displayMatrixRowUnit(unitRow);
  return u ? `${aggregated} ${u}` : String(aggregated);
}

function handoffDisplayTitle(row: SupplyMatrixRow): string {
  const raw = row.displayName;
  return row.supplyItemId != null ? stripTrailingQtyFromMatrixTitle(raw) : raw;
}

function buildHandoffMatrixPreview(
  items: Array<{ row: SupplyMatrixRow; cell: SupplyMatrixRow['byProperty'][number] }>,
  locale: string,
): HandoffMatrixPreview | null {
  if (!items.length) return null;

  /** Сводно по складу: суммируем quantitySum по всем выбранным ячейкам группы.
   * Для строк без распознанного числа бэкенд всё равно кладёт вклад в quantitySum (+1 за строку) и ставит quantityIsPartial —
   * раньше мы не прибавляли sum при partial, из‑за этого количество пропадало. */
  const whMap = new Map<string, { name: string; unit: string | null; sum: number }>();
  for (const { row, cell } of items) {
    const whKey = handoffMergeKey(row);
    if (!whMap.has(whKey)) {
      whMap.set(whKey, {
        name: handoffDisplayTitle(row),
        unit: displayMatrixRowUnit(row),
        sum: 0,
      });
    }
    const agg = whMap.get(whKey)!;
    agg.sum += cell.quantitySum;
    const du = displayMatrixRowUnit(row);
    if (du && !agg.unit?.trim()) {
      agg.unit = du;
    }
  }
  const warehouse = [...whMap.entries()].map(([key, v]) => {
    let qtyLabel: string;
    if (v.sum <= 0 || Number.isNaN(v.sum)) {
      qtyLabel = '';
    } else if (v.unit?.trim()) {
      qtyLabel = `${v.sum} ${v.unit.trim()}`;
    } else {
      qtyLabel = String(v.sum);
    }
    return { key, name: v.name, unit: v.unit, qtyLabel };
  });
  warehouse.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));

  type LineAcc = {
    key: string;
    name: string;
    qtySum: number;
    partial: boolean;
    unit: string | null;
  };
  const propMap = new Map<
    string,
    { propertyId: string; propertyTitle: string; lineMap: Map<string, LineAcc> }
  >();

  for (const { row, cell } of items) {
    const pid = cell.propertyId;
    const mk = handoffMergeKey(row);
    if (!propMap.has(pid)) {
      propMap.set(pid, {
        propertyId: pid,
        propertyTitle: cell.propertyTitle,
        lineMap: new Map(),
      });
    }
    const pm = propMap.get(pid)!;
    if (!pm.lineMap.has(mk)) {
      pm.lineMap.set(mk, {
        key: `${mk}|${pid}`,
        name: handoffDisplayTitle(row),
        qtySum: 0,
        partial: false,
        unit: displayMatrixRowUnit(row),
      });
    }
    const la = pm.lineMap.get(mk)!;
    la.qtySum += cell.quantitySum;
    la.partial = la.partial || cell.quantityIsPartial;
    const duLine = displayMatrixRowUnit(row);
    if (duLine && !la.unit?.trim()) {
      la.unit = duLine;
    }
  }

  const byProperty = [...propMap.values()].map((p) => {
    const lines = [...p.lineMap.values()].map((la) => {
      const qtyLabel =
        la.qtySum <= 0 && la.partial
          ? ''
          : la.unit?.trim()
            ? `${la.qtySum} ${la.unit.trim()}`
            : String(la.qtySum);
      return { key: la.key, name: la.name, qtyLabel };
    });
    lines.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
    return {
      propertyId: p.propertyId,
      propertyTitle: p.propertyTitle,
      lines,
    };
  });
  byProperty.sort((a, b) =>
    a.propertyTitle.localeCompare(b.propertyTitle, locale, { sensitivity: 'base' }),
  );

  return { warehouse, byProperty };
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
        <p className="font-normal text-foreground">{truncateMatrixText(event.textRaw, 220)}</p>
        {event.llmIntent?.trim() ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{event.llmIntent.trim()}</p>
        ) : null}
        <p className="mt-1 text-xs font-normal text-primary">{t('matrixProcessingStatus')}</p>
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
  const filters = useTasksFiltersStore((s) => s.filters);
  const assigneeNeedsTasks = filters.assigneeId !== 'all';
  const { data: tasksForAssigneeFilter, isPending: tasksAssigneePending } = useTasks(filters, {
    enabled: assigneeNeedsTasks,
  });

  const interpretationEventsFiltered = useMemo(() => {
    if (!assigneeNeedsTasks) return interpretationEvents;
    if (tasksAssigneePending) return interpretationEvents;
    const ids = new Set((tasksForAssigneeFilter?.tasks ?? []).map((x) => x.uuid));
    return interpretationEvents.filter((e) => {
      if (e.targetType !== 'task') return true;
      const tid = e.targetId?.trim();
      if (!tid) return false;
      return ids.has(tid);
    });
  }, [interpretationEvents, assigneeNeedsTasks, tasksAssigneePending, tasksForAssigneeFilter?.tasks]);

  const llmProcessingSupply = useMemo(
    () =>
      interpretationEventsFiltered.filter(
        (e: PendingSupplyInterpretationEvent) =>
          e.managerBucket === 'supply' &&
          (e.workflowState === 'pending_llm' || e.llmStatus === 'processing'),
      ),
    [interpretationEventsFiltered],
  );

  const { data: rows, isLoading, isPending, isFetching, isError, refetch } = useSupplyMatrix();
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
  const [handoffScheduledDate, setHandoffScheduledDate] = useState(handoffYmdFromToday(1));
  const [handoffCompleteByTime, setHandoffCompleteByTime] = useState('');
  const handoffDateInputRef = useRef<HTMLInputElement>(null);
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
        <span className="text-sm font-normal text-foreground">
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

  const [lineDeleteConfirm, setLineDeleteConfirm] = useState<{
    requestLineId: string;
    contextLine: string;
  } | null>(null);
  const removePoolLinesMutation = useSupplyMatrixRemovePoolLines();

  const lastNonEmptyRowsRef = useRef<SupplyMatrixRow[]>([]);

  useEffect(() => {
    const current = rows ?? [];
    if (current.length > 0) {
      lastNonEmptyRowsRef.current = current;
    }
  }, [rows]);

  /**
   * Бесшовный UX: если во время фонового refetch API кратко отдаёт пустой список,
   * не прячем секцию «В пуле», а держим последний стабильный срез до нового ответа.
   */
  const rowsForRender = useMemo(() => {
    const current = rows ?? [];
    if (current.length > 0) return current;
    if (isFetching && lastNonEmptyRowsRef.current.length > 0) {
      return lastNonEmptyRowsRef.current;
    }
    return current;
  }, [rows, isFetching]);

  const sortedRows = useMemo(() => {
    if (!rowsForRender.length) return [];
    return [...rowsForRender].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, locale, { sensitivity: 'base' }),
    );
  }, [rowsForRender, locale]);

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

  const handoffExistingRouteId = useMemo((): string | null => {
    const routeIds = new Set(
      handoffSelectedMatrixRows
        .map((r) => r.deliveryRouteIdForHandoff)
        .filter((id): id is string => Boolean(id)),
    );
    if (routeIds.size !== 1) return null;
    return [...routeIds][0] ?? null;
  }, [handoffSelectedMatrixRows]);

  const { data: handoffRouteDetail, isFetching: handoffRouteDetailLoading } = useDeliveryRouteDetail(
    handoffExistingRouteId,
    handoffOpen && Boolean(handoffExistingRouteId),
  );

  const handoffReassignDateDisplay = useMemo(() => {
    const d = handoffRouteDetail?.scheduledDate;
    if (!d) return null;
    try {
      return format(parseISO(`${d}T12:00:00`), 'd.MM.yyyy', { locale: dateLocale });
    } catch {
      return d;
    }
  }, [handoffRouteDetail?.scheduledDate, dateLocale]);

  const handoffNewRouteDateDisplay = useMemo(() => {
    try {
      return format(parseISO(`${handoffScheduledDate}T12:00:00`), 'd.MM.yyyy', { locale: dateLocale });
    } catch {
      return handoffScheduledDate;
    }
  }, [handoffScheduledDate, dateLocale]);

  const requestLineIdsForSelection = useMemo(
    () => collectRequestLineIdsFromKeys(selectedCellKeys, sortedRows),
    [selectedCellKeys, sortedRows],
  );

  const handoffSelectedCells = useMemo(
    () => collectHandoffSelectedCells(selectedCellKeys, sortedRows),
    [selectedCellKeys, sortedRows],
  );

  const handoffMatrixPreview = useMemo(
    () => buildHandoffMatrixPreview(handoffSelectedCells, locale),
    [handoffSelectedCells, locale],
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
    setHandoffScheduledDate(handoffYmdFromToday(1));
    setHandoffCompleteByTime('');
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
        const { routeId, merged, mergedInProgress } = await createRouteMutation.mutateAsync({
          requestLineIds: requestLineIdsForSelection,
          scheduledDate: handoffScheduledDate,
          completeByTime: handoffCompleteByTime.trim() ? handoffCompleteByTime.trim().slice(0, 8) : null,
        });
        if (!mergedInProgress) {
          await assignDriverMutation.mutateAsync({ routeId, driverUserId: handoffDriverId.trim() });
        }
        if (mergedInProgress) {
          toast.success(t('matrixHandoffSuccessMergedInProgress'));
        } else if (merged) {
          toast.success(t('matrixHandoffSuccessMerged'));
        } else {
          toast.success(t('matrixHandoffSuccessWithDriver'));
        }
      }
      setHandoffOpen(false);
      setHandoffDriverId('');
      setHandoffCompleteByTime('');
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

  const renderPropertyGroupsBlock = (
    groups: PropertyGroup[],
    scopeRows: SupplyMatrixRow[],
    routeContextId?: string,
  ) =>
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
      const routeCardOpen =
        inRoute && collapsePropKey ? collapsedById[collapsePropKey] !== true : false;

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
            const checked = selectedCellKeys.has(key);
            const mergedEvCount = mergedSourceEventsCount(row, cell, scopeRows);
            const qtyLabel = qtyBadgeLabel(cell, row, fs, scopeRows);
            const showQtyBadge =
              qtyLabel != null && !matrixQtySuffixRedundant(row.displayName, qtyLabel);
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
                    <span className="whitespace-pre-line text-[13px] font-normal leading-snug text-foreground sm:text-sm">
                      {row.displayName}
                    </span>
                    {showQtyBadge ? (
                      <Badge
                        variant="secondary"
                        className="border-0 bg-muted px-1 py-0 font-mono text-[10px] font-normal text-foreground sm:px-1.5 sm:text-[11px] dark:bg-muted/60"
                      >
                        {qtyLabel}
                      </Badge>
                    ) : null}
                  </div>
                  {mergedEvCount > 1 ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
                      {t('matrixSourceEvents', { count: mergedEvCount })}
                    </p>
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
            open={routeCardOpen}
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
                    routeCardOpen && 'rotate-90',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-normal leading-snug text-foreground sm:text-sm">
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
              <p className="text-[13px] font-normal leading-snug text-foreground sm:text-sm">
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

  const matrixDetailLinesBody = useMemo(() => {
    if (matrixCellDetailBodyLoading) {
      return (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        </div>
      );
    }
    const lines = detailLines ?? [];
    if (!lines.length) {
      return <p className="text-sm text-muted-foreground">{t('matrixCellDetailEmpty')}</p>;
    }
    return (
      <div className="space-y-3">
        {lines.map((line) => {
          const tt = (line.targetType ?? '').trim();
          const contextLine =
            tt === 'task'
              ? t('matrixDetailEntryTask', { title: line.targetSummary ?? '—' })
              : tt === 'incident'
                ? t('matrixDetailEntryIncident', { text: line.targetSummary ?? '—' })
                : tt === 'property'
                  ? t('matrixDetailEntryProperty', { title: line.propertyTitle ?? '—' })
                  : t('matrixDetailEntryOther');
          const poolRemovable =
            typeof line.canRemoveFromPool === 'boolean'
              ? line.canRemoveFromPool
              : (line.lineStatus ?? 'pending') === 'pending' && !String(line.deliveryRouteId ?? '').trim();
          const showRemove = Boolean(poolRemovable && contextLine);
          return (
            <div
              key={line.requestLineId}
              className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                {contextLine ? (
                  <p className="mb-2 text-[11px] font-medium leading-snug text-primary">{contextLine}</p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  {format(new Date(line.createdAt), 'PPp', { locale: dateLocale })} · {line.authorName || '—'}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{line.textRaw}</p>
                {(line.quantity || line.unit) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('itemsHeading')}: {line.llmRawName ?? '—'} · {[line.quantity, line.unit].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
              {showRemove ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-9 sm:w-9"
                  aria-label={t('matrixDetailRemoveFromPoolAria')}
                  disabled={removePoolLinesMutation.isPending}
                  onClick={() =>
                    setLineDeleteConfirm({
                      requestLineId: line.requestLineId,
                      contextLine,
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }, [matrixCellDetailBodyLoading, detailLines, t, dateLocale, removePoolLinesMutation.isPending]);

  /** Пока ИИ обрабатывает запрос, строки уже есть в ленте — не прячем сводку целиком скелетоном. */
  if (isPending && llmProcessingSupply.length === 0) {
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
                          {renderPropertyGroupsBlock(poolOnlyProcessing, poolRows)}
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
                        {renderPropertyGroupsBlock(poolGroupsWithProcessing, poolRows)}
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
                        {renderPropertyGroupsBlock(mixedGroups, mixedRows)}
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
            className="tasks-theme"
            title={t('matrixHandoffSheetTitle')}
            description={t('matrixHandoffSheetHint')}
            footer={
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setHandoffOpen(false)}>
                  {t('matrixHandoffSheetCancel')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'w-full sm:w-auto border-2 border-primary bg-primary/15 font-semibold text-foreground shadow-sm ring-2 ring-primary/25',
                    'hover:bg-primary/25 hover:text-foreground',
                  )}
                  disabled={handoffBusy || !handoffDriverId}
                  onClick={() => void confirmHandoffToDriver()}
                >
                  {handoffBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('matrixHandoffSheetConfirm')}
                </Button>
              </div>
            }
          >
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t('matrixHandoffDriverLabel')}</p>
              <AssigneePickerField
                variant="full"
                staff={(staffMembers ?? []) as StaffMember[]}
                value={handoffDriverId || null}
                onChange={(id) => setHandoffDriverId(id ?? '')}
                quickPickLimit={4}
                omitUnassignedQuickButton
                showAssigneeModalHint={false}
                allowUnassignedInModal={false}
              />
              <div className="border-t border-border/60 pt-3">
                {handoffExistingRouteId ? (
                  <p className="text-sm leading-snug text-muted-foreground">
                    {handoffRouteDetailLoading || !handoffReassignDateDisplay ? (
                      <span className="inline-flex items-center gap-1.5" aria-hidden>
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        …
                      </span>
                    ) : (
                      t('matrixHandoffDateReassignNote', { date: handoffReassignDateDisplay })
                    )}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('matrixHandoffDateLabel')}
                        </p>
                        <p className="text-base font-bold tabular-nums text-foreground">{handoffNewRouteDateDisplay}</p>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <input
                          ref={handoffDateInputRef}
                          type="date"
                          className="sr-only"
                          value={handoffScheduledDate}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) setHandoffScheduledDate(v);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 border-border/80"
                          onClick={() => {
                            const el = handoffDateInputRef.current;
                            if (el) {
                              if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
                                (el as HTMLInputElement & { showPicker: () => void }).showPicker();
                              } else {
                                el.click();
                              }
                            }
                          }}
                          aria-label={t('matrixHandoffDateCalendarAria')}
                        >
                          <Calendar className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { off: 0, labelKey: 'matrixHandoffDateToday' as const },
                          { off: 1, labelKey: 'matrixHandoffDateTomorrow' as const },
                          { off: 2, labelKey: 'matrixHandoffDateDayAfter' as const },
                        ] as const
                      ).map(({ off, labelKey }) => {
                        const ymd = handoffYmdFromToday(off);
                        const active = handoffScheduledDate === ymd;
                        return (
                          <Button
                            key={labelKey}
                            type="button"
                            variant="outline"
                            className={cn(
                              'h-9 rounded-full px-3 text-sm font-medium',
                              active
                                ? 'border-2 border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/20'
                                : 'border border-transparent bg-muted/50 text-muted-foreground hover:bg-muted/70',
                            )}
                            onClick={() => setHandoffScheduledDate(ymd)}
                          >
                            {t(labelKey)}
                          </Button>
                        );
                      })}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="handoff-complete-by-time"
                        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {t('matrixHandoffCompleteByLabel')}
                      </Label>
                      <Input
                        id="handoff-complete-by-time"
                        type="time"
                        value={handoffCompleteByTime}
                        onChange={(e) => setHandoffCompleteByTime(e.target.value)}
                        className="h-10 w-full max-w-[9rem] rounded-md border border-input bg-input-fill px-2.5 text-sm [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-primary/20"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('matrixHandoffPreviewTitle')}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t('matrixHandoffPreviewHint')}</p>
                {handoffExistingRouteId ? (
                  handoffRouteDetailLoading && !handoffRouteDetail ? (
                    <div className="mt-3 flex justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : handoffRouteDetail ? (
                    <div className="mt-3 max-h-[min(40vh,22rem)] space-y-3 overflow-y-auto pr-0.5 text-sm">
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                          {t('deliveryRoutePicking')}
                        </p>
                        {handoffRouteDetail.pickingLines.length ? (
                          <ul className="mt-1.5 space-y-1">
                            {handoffRouteDetail.pickingLines.map((pl, i) => (
                              <li key={`hfp-${i}-${pl.name}`} className="flex gap-2 text-[13px] leading-snug">
                                <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span>
                                  {pl.name}{' '}
                                  <span className="text-muted-foreground">
                                    {pl.quantity}
                                    {pl.unit ? ` ${pl.unit}` : ''}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-[13px] text-muted-foreground">—</p>
                        )}
                      </div>
                      {handoffRouteDetail.stops
                        .filter((s) => s.kind === 'property')
                        .map((s) => (
                          <div key={s.id} className="rounded-lg border border-border/60 bg-card/50 p-2.5">
                            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {s.propertyTitle ?? '—'}
                            </p>
                            {s.lines.length ? (
                              <ul className="mt-1.5 space-y-1 pl-0.5">
                                {s.lines.map((ln, j) => (
                                  <li key={`${s.id}-ln-${j}`} className="text-[13px] leading-snug">
                                    {ln.name}{' '}
                                    <span className="text-muted-foreground">
                                      {ln.quantity ?? '—'}
                                      {ln.unit ? ` ${ln.unit}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1.5 text-[13px] text-muted-foreground">—</p>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : null
                ) : !handoffMatrixPreview ? (
                  <p className="mt-3 text-sm text-muted-foreground">{t('matrixHandoffPreviewEmpty')}</p>
                ) : (
                  <div className="mt-3 max-h-[min(40vh,22rem)] space-y-3 overflow-y-auto pr-0.5 text-sm">
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        {t('matrixHandoffPreviewWarehouse')}
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {handoffMatrixPreview.warehouse.map((w) => {
                          const showQty = w.qtyLabel && !matrixQtySuffixRedundant(w.name, w.qtyLabel);
                          return (
                          <li key={w.key} className="flex gap-2 text-[13px] leading-snug">
                            <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>
                              {w.name}
                              {showQty ? (
                                <>
                                  {' '}
                                  <span className="tabular-nums text-muted-foreground">{w.qtyLabel}</span>
                                </>
                              ) : null}
                            </span>
                          </li>
                          );
                        })}
                      </ul>
                    </div>
                    {handoffMatrixPreview.byProperty.map((g) => (
                      <div key={g.propertyId} className="rounded-lg border border-border/60 bg-card/50 p-2.5">
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {g.propertyTitle}
                        </p>
                        <ul className="mt-1.5 space-y-1 pl-0.5">
                          {g.lines.map((ln) => {
                            const showQty = ln.qtyLabel && !matrixQtySuffixRedundant(ln.name, ln.qtyLabel);
                            return (
                            <li key={ln.key} className="text-[13px] leading-snug">
                              {ln.name}
                              {showQty ? (
                                <>
                                  {' '}
                                  <span className="tabular-nums text-muted-foreground">{ln.qtyLabel}</span>
                                </>
                              ) : null}
                            </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Dialog open={Boolean(lineDeleteConfirm)} onOpenChange={(o) => !o && setLineDeleteConfirm(null)}>
          <DialogContent
            title={t('matrixDetailRemoveLineConfirmTitle')}
            description={
              lineDeleteConfirm
                ? t('matrixDetailRemoveLineConfirmDescription', { contextLine: lineDeleteConfirm.contextLine })
                : undefined
            }
            footer={
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setLineDeleteConfirm(null)}
                >
                  {t('matrixHandoffSheetCancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={removePoolLinesMutation.isPending || !lineDeleteConfirm?.requestLineId}
                  onClick={() => {
                    if (!lineDeleteConfirm?.requestLineId) return;
                    const rid = lineDeleteConfirm.requestLineId;
                    removePoolLinesMutation.mutate([rid], {
                      onSuccess: (data) => {
                        setDrawerLineIds((prev) => {
                          if (!prev?.length) return prev;
                          const next = prev.filter((id) => id !== rid);
                          return next.length ? next : null;
                        });
                        toast.success(t('matrixRemovePoolLinesSuccess', { count: data.deleted }));
                        setLineDeleteConfirm(null);
                      },
                      onError: () => toast.error(t('matrixRemovePoolLinesError')),
                    });
                  }}
                >
                  {removePoolLinesMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  ) : null}
                  {t('matrixDetailRemoveLineConfirm')}
                </Button>
              </div>
            }
          />
        </Dialog>

        {isMdUp ? (
          <Sheet open={Boolean(drawerLineIds?.length)} onOpenChange={(o) => !o && setDrawerLineIds(null)}>
            <SheetContent title={t('matrixCellDetailTitle')} description={t('matrixCellDetailHint')}>
              {matrixDetailLinesBody}
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer open={Boolean(drawerLineIds?.length)} onOpenChange={(o) => !o && setDrawerLineIds(null)}>
            <DrawerContent title={t('matrixCellDetailTitle')} description={t('matrixCellDetailHint')}>
              <div className="max-h-[min(60vh,420px)] overflow-y-auto px-4 pb-6 pt-2">{matrixDetailLinesBody}</div>
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
