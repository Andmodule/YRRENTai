'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslations } from 'next-intl';
import { ChevronDown, Mic, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMatchMedia } from '@/hooks/use-match-media';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Task, TaskStatus } from '../../types';
import {
  groupTasksAndIncidentsForBoard,
  GENERAL_TASK_PROPERTY_GROUP_KEY,
  INCIDENTS_BOARD_GROUP_KEY,
  SHORTAGE_BOARD_GROUP_KEY,
  OBJECTS_WRAPPER_GROUP_KEY,
  type TaskPropertyGroup,
} from '../../utils/groupTasksByProperty';
import type { PendingSupplyInterpretationEvent } from '../../types';
import { SupplyShortageListRow } from './SupplyShortageListRow';
import { useTaskListCollapsedGroups } from '../../hooks/useTaskListCollapsedGroups';
import { TaskListRow } from './TaskListRow';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentListRow } from '@/modules/incidents/components/IncidentListRow';
import { VoiceTaskCreateSheet, type VoiceTaskCreateSheetHandle } from './VoiceTaskCreateSheet';
import { Link, usePathname } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { TASK_MANAGER_PANEL_QUERY } from '../../task-url-params';

/** Короткий debounce только чтобы понять «скролл остановился» — показ включаем сразу после него. */
const FAB_SCROLL_END_DEBOUNCE_MS = 100;
/** Длительность плавного появления/пропадания (только opacity), видимая анимация. */
const FAB_FADE_MS = 1500;

/**
 * Блок «Нехватка и логистика» в списке задач дублирует вкладку «Снабжение и логистика» — временно скрыт.
 * TODO REMOVE: поставить `true` или удалить фильтр `groupsForList` ниже, когда снова понадобится секция в задачах.
 */
const SHOW_SHORTAGE_SECTION_IN_TASK_LIST = false;

function getScrollableParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const { overflowY, overflow } = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(overflowY) || /(auto|scroll|overlay)/.test(overflow)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export const TaskListView = memo(function TaskListView({
  tasks,
  boardIncidents,
  boardShortage = [],
  onOpenTask,
  onOpenIncident,
  onOpenSupplyInterpretation,
  onStatusChange,
  onSwipeDeleteTask,
  onSwipeMarkDone,
  onSwipeCloseIncident,
  voiceQuickAdd = true,
  /** Manager list: всегда показывать свёртку «Нехватка» (пустую очередь тоже). В TMA — false. */
  showShortageWhenEmpty = true,
}: {
  tasks: Task[];
  boardIncidents: Incident[];
  /** Очередь нехватки / снабжения (тот же источник, что вкладка «Снабжение и логистика»). */
  boardShortage?: PendingSupplyInterpretationEvent[];
  onOpenTask: (t: Task) => void;
  onOpenIncident: (i: Incident) => void;
  onOpenSupplyInterpretation: (e: PendingSupplyInterpretationEvent) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
  onSwipeDeleteTask?: (task: Task) => void;
  onSwipeMarkDone?: (task: Task) => void;
  onSwipeCloseIncident?: (incident: Incident) => void;
  /** Telegram Mini App staff list: hide manager-only voice create. */
  voiceQuickAdd?: boolean;
  showShortageWhenEmpty?: boolean;
}) {
  const tList = useTranslations('tasks.listByProperty');
  const tTasks = useTranslations('tasks');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const supplyTabHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(TASK_MANAGER_PANEL_QUERY, 'supply');
    return `${pathname}?${params.toString()}`;
  }, [pathname, searchParams]);

  const groups = useMemo(
    () =>
      groupTasksAndIncidentsForBoard(tasks, boardIncidents, boardShortage, {
        alwaysShowShortageGroup: showShortageWhenEmpty,
      }),
    [tasks, boardIncidents, boardShortage, showShortageWhenEmpty],
  );

  /** Defensive: never render a property block with nothing to show (filters / data edge cases). */
  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          (showShortageWhenEmpty && g.propertyId === SHORTAGE_BOARD_GROUP_KEY) ||
          g.tasks.length > 0 ||
          g.incidents.length > 0 ||
          g.shortageEvents.length > 0,
      ),
    [groups, showShortageWhenEmpty],
  );

  const groupsForList = useMemo(
    () =>
      SHOW_SHORTAGE_SECTION_IN_TASK_LIST
        ? visibleGroups
        : visibleGroups.filter((g) => g.propertyId !== SHORTAGE_BOARD_GROUP_KEY),
    [visibleGroups],
  );

  const { incidentGroup, shortageGroup, generalGroup, propertyGroups } = useMemo(() => {
    let incident: TaskPropertyGroup | null = null;
    let shortage: TaskPropertyGroup | null = null;
    let general: TaskPropertyGroup | null = null;
    const properties: TaskPropertyGroup[] = [];
    for (const g of groupsForList) {
      if (g.propertyId === INCIDENTS_BOARD_GROUP_KEY) incident = g;
      else if (g.propertyId === SHORTAGE_BOARD_GROUP_KEY) shortage = g;
      else if (g.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY) general = g;
      else properties.push(g);
    }
    return {
      incidentGroup: incident,
      shortageGroup: shortage,
      generalGroup: general,
      propertyGroups: properties,
    };
  }, [groupsForList]);

  const objectsTaskTotal = useMemo(
    () => propertyGroups.reduce((sum, g) => sum + g.tasks.length, 0),
    [propertyGroups],
  );

  const { collapsedById, setCollapsed } = useTaskListCollapsedGroups();
  const isMdUp = useMatchMedia('(min-width: 768px)');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePropertyId, setVoicePropertyId] = useState<string | null>(null);
  /** `voice` = mic FAB; `manual-*` = карандаш → выбор в меню, затем форма без микрофона. */
  const [fabEntry, setFabEntry] = useState<'voice' | 'manual-task' | 'manual-incident'>('voice');
  const voiceSheetRef = useRef<VoiceTaskCreateSheetHandle>(null);
  /** Only one row may show the swipe-delete “peek” strip at a time; cleared when opening another row. */
  const [swipeOpenRowId, setSwipeOpenRowId] = useState<string | null>(null);

  const handleOpenTask = useCallback(
    (t: Task) => {
      setSwipeOpenRowId(null);
      onOpenTask(t);
    },
    [onOpenTask],
  );

  const handleOpenIncident = useCallback(
    (i: Incident) => {
      setSwipeOpenRowId(null);
      onOpenIncident(i);
    },
    [onOpenIncident],
  );

  const handleOpenSupply = useCallback(
    (e: PendingSupplyInterpretationEvent) => {
      setSwipeOpenRowId(null);
      onOpenSupplyInterpretation(e);
    },
    [onOpenSupplyInterpretation],
  );

  /** Первый объект из секции «Объекты» (не инциденты / не общие). */
  const fabPropertyId = propertyGroups[0]?.propertyId ?? null;

  /** Voice-first: open sheet and start mic in the same tap/click (required for mobile Safari `getUserMedia`). */
  const openVoiceSheet = useCallback((propertyId: string) => {
    flushSync(() => {
      setFabEntry('voice');
      setVoicePropertyId(propertyId);
      setVoiceOpen(true);
    });
    if (!isMdUp) {
      voiceSheetRef.current?.startRecordingFromUserGesture();
    }
  }, [isMdUp]);

  const openManualSheet = useCallback((propertyId: string, kind: 'task' | 'incident') => {
    flushSync(() => {
      setFabEntry(kind === 'incident' ? 'manual-incident' : 'manual-task');
      setVoicePropertyId(propertyId);
      setVoiceOpen(true);
    });
  }, []);

  const listRootRef = useRef<HTMLDivElement>(null);
  const [fabHiddenByScroll, setFabHiddenByScroll] = useState(false);
  const fabScrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!voiceQuickAdd || isMdUp) return;
    const root = listRootRef.current;
    if (!root) return;
    const scrollEl = getScrollableParent(root) ?? document.documentElement;

    const onScroll = () => {
      setFabHiddenByScroll(true);
      if (fabScrollIdleTimerRef.current) clearTimeout(fabScrollIdleTimerRef.current);
      fabScrollIdleTimerRef.current = setTimeout(() => {
        setFabHiddenByScroll(false);
        fabScrollIdleTimerRef.current = null;
      }, FAB_SCROLL_END_DEBOUNCE_MS);
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      if (fabScrollIdleTimerRef.current) clearTimeout(fabScrollIdleTimerRef.current);
    };
  }, [voiceQuickAdd, isMdUp, groupsForList.length]);

  const renderGroupSection = (group: TaskPropertyGroup, nested?: boolean) => {
    const collapsed = collapsedById[group.propertyId] ?? false;
    const displayTitle =
      group.propertyId === INCIDENTS_BOARD_GROUP_KEY
        ? tList('incidentsTopHeading')
        : group.propertyId === SHORTAGE_BOARD_GROUP_KEY
          ? tList('shortageTopHeading')
          : group.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY
            ? tList('generalTitle')
            : group.propertyTitle || tList('unnamedProperty');

    const addressLine =
      group.propertyId === INCIDENTS_BOARD_GROUP_KEY ||
      group.propertyId === SHORTAGE_BOARD_GROUP_KEY ||
      group.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY
        ? null
        : group.propertyAddress || null;

    /** В шапке только desktop: на мобайле без текста — создание через FAB «матрёшку». Блок нехватки — без кнопки. */
    const showAddTaskInHeader =
      voiceQuickAdd &&
      isMdUp &&
      group.propertyId !== SHORTAGE_BOARD_GROUP_KEY;

    const incidentsSectionCount =
      group.propertyId === INCIDENTS_BOARD_GROUP_KEY ? group.incidents.length : 0;

    return (
      <section
        key={group.propertyId}
        className={cn(
          'relative isolate min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm',
          nested ? 'scroll-mt-1' : 'scroll-mt-2',
          'dark:border-border dark:bg-card/80',
        )}
        aria-label={displayTitle}
      >
        <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(group.propertyId, !open)}>
          <div
            className={cn(
              'sticky top-0 z-20 flex w-full min-w-0 items-center gap-1 border-b border-border',
              'bg-muted/80 dark:bg-muted/40',
              'dark:border-border',
            )}
          >
            <CollapsibleTrigger
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-2 pr-1 text-left transition-colors md:pl-3',
                'hover:bg-muted/60 dark:hover:bg-muted/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <ChevronDown
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  collapsed && '-rotate-90',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                    {displayTitle}
                  </h2>
                  {group.propertyId === INCIDENTS_BOARD_GROUP_KEY ? (
                    <span
                      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-destructive/12 px-1 text-[10px] font-semibold tabular-nums leading-none text-destructive dark:text-red-400"
                      aria-label={tList('incidentCount', { count: incidentsSectionCount })}
                    >
                      {incidentsSectionCount}
                    </span>
                  ) : group.propertyId === SHORTAGE_BOARD_GROUP_KEY ? (
                    <span
                      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold tabular-nums leading-none text-primary"
                      aria-label={tList('shortageCount', { count: group.shortageEvents.length })}
                    >
                      {group.shortageEvents.length}
                    </span>
                  ) : (
                    <span
                      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted px-1 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground"
                      aria-label={tList('taskCount', { count: group.tasks.length })}
                    >
                      {group.tasks.length}
                    </span>
                  )}
                </div>
                {addressLine ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">{addressLine}</p>
                ) : null}
              </div>
            </CollapsibleTrigger>
            {showAddTaskInHeader ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  openVoiceSheet(group.propertyId);
                }}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-right text-xs font-semibold text-primary transition-colors',
                  'hover:bg-primary/10 hover:text-primary/90',
                  'md:px-2.5 md:text-sm',
                )}
              >
                {tList(group.propertyId === INCIDENTS_BOARD_GROUP_KEY ? 'addIncident' : 'addTask')}
              </button>
            ) : null}
          </div>

          <CollapsibleContent className="bg-card dark:bg-transparent">
            <ul className="flex min-w-0 flex-col px-0" role="list">
              {group.propertyId === SHORTAGE_BOARD_GROUP_KEY &&
              group.shortageEvents.length === 0 &&
              showShortageWhenEmpty ? (
                <li className="min-w-0 px-3 py-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {tList('shortageEmptyHint')}{' '}
                    <Link
                      href={supplyTabHref}
                      className="font-medium text-primary underline underline-offset-2 hover:text-primary/90"
                    >
                      {tList('shortageSupplyTabLink')}
                    </Link>
                  </p>
                </li>
              ) : null}
              {group.shortageEvents.map((ev) => (
                <li key={`sq-${ev.id}`} className="min-w-0">
                  <SupplyShortageListRow event={ev} onOpen={handleOpenSupply} variant="supply" />
                </li>
              ))}
              {group.propertyId === INCIDENTS_BOARD_GROUP_KEY
                ? group.incidents.map((incident) => (
                    <li key={`inc-${incident.uuid}`} className="min-w-0">
                      <IncidentListRow
                        incident={incident}
                        onOpen={handleOpenIncident}
                        swipeOpenRowId={swipeOpenRowId}
                        onSwipeRowOpenChange={setSwipeOpenRowId}
                        onSwipeCloseIncident={onSwipeCloseIncident}
                        hidePropertyContext={false}
                      />
                    </li>
                  ))
                : group.incidents.map((incident) => (
                    <li key={`inc-${incident.uuid}`} className="min-w-0">
                      <IncidentListRow
                        incident={incident}
                        onOpen={handleOpenIncident}
                        swipeOpenRowId={swipeOpenRowId}
                        onSwipeRowOpenChange={setSwipeOpenRowId}
                        onSwipeCloseIncident={onSwipeCloseIncident}
                        hidePropertyContext={
                          group.propertyId !== GENERAL_TASK_PROPERTY_GROUP_KEY &&
                          group.propertyId !== INCIDENTS_BOARD_GROUP_KEY
                        }
                      />
                    </li>
                  ))}
              {group.tasks.map((task) => (
                <li key={task.uuid} className="min-w-0">
                  <TaskListRow
                    task={task}
                    onOpen={handleOpenTask}
                    onStatusChange={onStatusChange}
                    onSwipeDeleteTask={onSwipeDeleteTask}
                    onSwipeMarkDone={onSwipeMarkDone}
                    swipeOpenRowId={swipeOpenRowId}
                    onSwipeRowOpenChange={setSwipeOpenRowId}
                  />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </section>
    );
  };

  const objectsCollapsed = collapsedById[OBJECTS_WRAPPER_GROUP_KEY] ?? false;

  return (
    <div
      ref={listRootRef}
      className="relative flex min-w-0 flex-col gap-1.5 pb-[max(9rem,calc(9rem+env(safe-area-inset-bottom,0px)))] md:gap-3 md:pb-0"
    >
      {incidentGroup ? renderGroupSection(incidentGroup) : null}
      {shortageGroup ? renderGroupSection(shortageGroup) : null}
      {generalGroup ? renderGroupSection(generalGroup) : null}
      {propertyGroups.length > 0 ? (
        <section
          key={OBJECTS_WRAPPER_GROUP_KEY}
          className={cn(
            'relative isolate min-w-0 overflow-hidden scroll-mt-2 rounded-2xl border border-border bg-card shadow-sm',
            'dark:border-border dark:bg-card/80',
          )}
          aria-label={tList('objectsTopHeading')}
        >
          <Collapsible
            open={!objectsCollapsed}
            onOpenChange={(open) => setCollapsed(OBJECTS_WRAPPER_GROUP_KEY, !open)}
          >
            <div
              className={cn(
                'sticky top-0 z-20 border-b border-border',
                'bg-muted/80 dark:bg-muted/40',
                'dark:border-border',
              )}
            >
              <CollapsibleTrigger
                className={cn(
                  'flex w-full min-w-0 items-start gap-2 px-2 py-2.5 text-left transition-colors md:px-3',
                  'hover:bg-muted/60 dark:hover:bg-muted/20',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <ChevronDown
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    objectsCollapsed && '-rotate-90',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="text-sm font-semibold leading-tight tracking-tight text-foreground">
                      {tList('objectsTopHeading')}
                    </h2>
                    <span
                      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted px-1 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground"
                      aria-label={tList('taskCount', { count: objectsTaskTotal })}
                    >
                      {objectsTaskTotal}
                    </span>
                  </div>
                </div>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="bg-card dark:bg-transparent">
              <div className="flex min-w-0 flex-col gap-1.5 px-1.5 pb-2 pt-0 md:gap-3 md:px-2 md:pb-3">
                {propertyGroups.map((g) => renderGroupSection(g, true))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      ) : null}

      {voiceQuickAdd && !isMdUp && fabPropertyId ? (
        <div
          className={cn(
            'pointer-events-none fixed z-50 flex flex-col items-center',
            'right-[max(1.5rem,env(safe-area-inset-right,0px))]',
            /* iOS Safari: нижняя панель (табы/навигация) не входит в safe-area — поднимаем «матрёшку» над хромом */
            'bottom-[max(4.75rem,calc(env(safe-area-inset-bottom,0px)+4.25rem))]',
            'w-[4.2rem]',
          )}
        >
          <div
            className={cn(
              'flex w-full flex-col items-center gap-3 [transform:translateZ(0)]',
              fabHiddenByScroll
                ? 'pointer-events-none opacity-0'
                : 'pointer-events-auto opacity-100',
            )}
            style={{ transition: `opacity ${FAB_FADE_MS}ms ease-in-out` }}
          >
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full touch-manipulation',
                    'border-[1.5px] border-primary bg-card text-primary shadow-md shadow-foreground/8',
                    'transition-[box-shadow,transform] active:scale-[0.97]',
                    'dark:bg-card/90 dark:shadow-black/25',
                  )}
                  aria-label={tList('manualFabAria')}
                >
                  <Pencil className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="end"
                  sideOffset={10}
                  className={cn(
                    'z-[200] flex w-[min(11rem,calc(100svw-2rem))] min-w-0 flex-col gap-2 border-0 bg-transparent p-0 shadow-none outline-none',
                    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                  )}
                >
                  <DropdownMenu.Item
                    className={cn(
                      'flex cursor-pointer select-none items-center justify-center rounded-2xl border px-3 py-2.5 text-[13px] font-semibold leading-tight outline-none',
                      'border-primary/35 bg-card/95 text-primary shadow-sm shadow-primary/10 backdrop-blur-md',
                      'transition-[transform,box-shadow,border-color] active:scale-[0.99]',
                      'data-[highlighted]:border-primary/60 data-[highlighted]:bg-primary/10 data-[highlighted]:shadow-md',
                      'dark:bg-card/80 dark:data-[highlighted]:bg-primary/15',
                    )}
                    onSelect={() => openManualSheet(GENERAL_TASK_PROPERTY_GROUP_KEY, 'task')}
                  >
                    {tTasks('smartCreate.tabTask')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={cn(
                      'flex cursor-pointer select-none items-center justify-center rounded-2xl border px-3 py-2.5 text-[13px] font-semibold leading-tight outline-none',
                      'border-primary/35 bg-card/95 text-primary shadow-sm shadow-primary/10 backdrop-blur-md',
                      'transition-[transform,box-shadow,border-color] active:scale-[0.99]',
                      'data-[highlighted]:border-primary/60 data-[highlighted]:bg-primary/10 data-[highlighted]:shadow-md',
                      'dark:bg-card/80 dark:data-[highlighted]:bg-primary/15',
                    )}
                    onSelect={() => openManualSheet(GENERAL_TASK_PROPERTY_GROUP_KEY, 'incident')}
                  >
                    {tTasks('smartCreate.tabIncident')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <button
              type="button"
              onClick={() => openVoiceSheet(fabPropertyId)}
              className={cn(
                'flex h-[4.2rem] w-[4.2rem] shrink-0 cursor-pointer items-center justify-center rounded-full touch-manipulation',
                'bg-primary text-primary-foreground shadow-lg shadow-primary/30',
                'transition-[box-shadow,transform] hover:bg-primary/90 active:scale-[0.98]',
                'dark:shadow-black/40',
              )}
              aria-label={tList('voiceFabAria')}
            >
              <Mic className="h-[1.8rem] w-[1.8rem]" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {voiceQuickAdd && (fabPropertyId ?? voicePropertyId) ? (
        <VoiceTaskCreateSheet
          ref={voiceSheetRef}
          open={voiceOpen}
          onOpenChange={(o) => {
            setVoiceOpen(o);
            if (!o) {
              setVoicePropertyId(null);
              setFabEntry('voice');
            }
          }}
          propertyId={(voicePropertyId ?? fabPropertyId)!}
          startWithManualForm={fabEntry === 'manual-task' || fabEntry === 'manual-incident'}
          manualEntityTab={fabEntry === 'manual-incident' ? 'incident' : 'task'}
        />
      ) : null}
    </div>
  );
});
