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
} from '../../utils/groupTasksByProperty';
import { useTaskListCollapsedGroups } from '../../hooks/useTaskListCollapsedGroups';
import { TaskListRow } from './TaskListRow';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import { IncidentListRow } from '@/modules/incidents/components/IncidentListRow';
import { VoiceTaskCreateSheet, type VoiceTaskCreateSheetHandle } from './VoiceTaskCreateSheet';

/** Короткий debounce только чтобы понять «скролл остановился» — показ включаем сразу после него. */
const FAB_SCROLL_END_DEBOUNCE_MS = 100;
/** Длительность плавного появления/пропадания (только opacity), видимая анимация. */
const FAB_FADE_MS = 1500;

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
  onOpenTask,
  onOpenIncident,
  onStatusChange,
  onSwipeDeleteTask,
  onSwipeMarkDone,
  onSwipeCloseIncident,
  voiceQuickAdd = true,
}: {
  tasks: Task[];
  boardIncidents: Incident[];
  onOpenTask: (t: Task) => void;
  onOpenIncident: (i: Incident) => void;
  onStatusChange: (uuid: string, status: TaskStatus) => void;
  onSwipeDeleteTask?: (task: Task) => void;
  onSwipeMarkDone?: (task: Task) => void;
  onSwipeCloseIncident?: (incident: Incident) => void;
  /** Telegram Mini App staff list: hide manager-only voice create. */
  voiceQuickAdd?: boolean;
}) {
  const tList = useTranslations('tasks.listByProperty');
  const tTasks = useTranslations('tasks');

  const groups = useMemo(
    () => groupTasksAndIncidentsForBoard(tasks, boardIncidents),
    [tasks, boardIncidents],
  );

  /** Defensive: never render a property block with nothing to show (filters / data edge cases). */
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tasks.length > 0 || g.incidents.length > 0),
    [groups],
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

  const fabPropertyId = useMemo(() => {
    const g = visibleGroups.find((x) => x.propertyId !== GENERAL_TASK_PROPERTY_GROUP_KEY);
    return g?.propertyId ?? null;
  }, [visibleGroups]);

  /** Voice-first: open sheet and start mic in the same tap/click (required for mobile Safari `getUserMedia`). */
  const openVoiceSheet = useCallback((propertyId: string) => {
    flushSync(() => {
      setFabEntry('voice');
      setVoicePropertyId(propertyId);
      setVoiceOpen(true);
    });
    voiceSheetRef.current?.startRecordingFromUserGesture();
  }, []);

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
  }, [voiceQuickAdd, isMdUp, visibleGroups.length]);

  return (
    <div ref={listRootRef} className="relative flex min-w-0 flex-col gap-1.5 pb-36 md:gap-3 md:pb-0">
      {visibleGroups.map((group) => {
        const collapsed = collapsedById[group.propertyId] ?? false;
        const displayTitle =
          group.propertyId === INCIDENTS_BOARD_GROUP_KEY
            ? tList('incidentsTopHeading')
            : group.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY
              ? tList('generalTitle')
              : group.propertyTitle || tList('unnamedProperty');

        const addressLine =
          group.propertyId === INCIDENTS_BOARD_GROUP_KEY || group.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY
            ? null
            : group.propertyAddress || null;

        const isPropertySection =
          group.propertyId !== GENERAL_TASK_PROPERTY_GROUP_KEY &&
          group.propertyId !== INCIDENTS_BOARD_GROUP_KEY;
        /** Десктоп: «+ Добавить задачу» и для общих/инцидентов; мобайл — только FAB. */
        const showAddTaskFooter =
          voiceQuickAdd && (isPropertySection || (isMdUp && !isPropertySection));

        return (
          <section
            key={group.propertyId}
            className={cn(
              'min-w-0 overflow-hidden scroll-mt-2 rounded-2xl border border-slate-200/80 bg-white shadow-sm',
              'dark:border-slate-700/75 dark:bg-slate-900/35',
            )}
            aria-label={displayTitle}
          >
            <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(group.propertyId, !open)}>
              <div
                className={cn(
                  'sticky top-0 z-20 rounded-t-2xl border-b border-slate-200/70',
                  'bg-slate-50/95',
                  'dark:border-slate-700/60 dark:bg-slate-900/90',
                )}
              >
                <CollapsibleTrigger
                  className={cn(
                    'flex w-full min-w-0 items-start gap-2 px-2 py-2.5 text-left transition-colors md:px-3',
                    'hover:bg-slate-200/65 dark:hover:bg-white/[0.05]',
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
                          className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 px-1 text-[10px] font-semibold tabular-nums leading-none text-red-700 dark:text-red-400"
                          aria-label={tList('incidentCount', { count: group.incidents.length })}
                        >
                          {group.incidents.length}
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-slate-100/90 px-1 text-[10px] font-semibold tabular-nums leading-none text-slate-600 dark:border-slate-600/70 dark:bg-slate-800/80 dark:text-slate-400"
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
              </div>

              <CollapsibleContent className="bg-white dark:bg-transparent">
                <ul className="flex min-w-0 flex-col px-0" role="list">
                  {group.incidents.map((incident) => (
                    <li
                      key={`inc-${incident.uuid}`}
                      className={cn(
                        'min-w-0 border-l-2 border-l-red-500/55',
                        'bg-red-500/[0.05] dark:bg-red-950/30',
                      )}
                    >
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
                        className="border-b border-red-500/15 hover:bg-red-500/10 dark:hover:bg-red-950/40"
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
                {showAddTaskFooter ? (
                  <div
                    className={cn(
                      'border-t border-border/40 px-2 py-1 md:px-3',
                      !isMdUp && 'hidden',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openVoiceSheet(group.propertyId)}
                      className={cn(
                        'flex w-full items-center justify-center rounded-md py-2 text-sm font-medium',
                        'text-[#008CA4] transition-colors hover:bg-[#008CA4]/8 hover:text-[#007a90]',
                        'dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10',
                      )}
                    >
                      {tList('addTask')}
                    </button>
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          </section>
        );
      })}

      {voiceQuickAdd && !isMdUp && fabPropertyId ? (
        <div
          className={cn(
            'pointer-events-none fixed right-6 z-50 flex flex-col items-center',
            'bottom-[max(2.25rem,env(safe-area-inset-bottom))]',
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
                    'border-[1.5px] border-[#008CA4] bg-white text-[#008CA4] shadow-md shadow-slate-900/10',
                    'transition-[box-shadow,transform] active:scale-[0.97]',
                    'dark:border-[#008CA4] dark:bg-slate-950 dark:text-[#00d4ff] dark:shadow-black/25',
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
                    'z-[200] flex w-[min(11rem,calc(100vw-2rem))] min-w-0 flex-col gap-2 border-0 bg-transparent p-0 shadow-none outline-none',
                    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                  )}
                >
                  <DropdownMenu.Item
                    className={cn(
                      'flex cursor-pointer select-none items-center justify-center rounded-2xl border px-3 py-2.5 text-[13px] font-semibold leading-tight outline-none',
                      'border-[#008CA4]/40 bg-white/90 text-[#0a6b7a] shadow-sm shadow-[#008CA4]/12 backdrop-blur-md',
                      'transition-[transform,box-shadow,border-color] active:scale-[0.99]',
                      'dark:border-[#008CA4]/45 dark:bg-slate-950/65 dark:text-[#a5e9ff]',
                      'dark:shadow-[#008CA4]/15 data-[highlighted]:border-[#008CA4]/70 data-[highlighted]:bg-[#008CA4]/10',
                      'data-[highlighted]:shadow-md data-[highlighted]:shadow-[#008CA4]/20 dark:data-[highlighted]:bg-[#008CA4]/15',
                    )}
                    onSelect={() => openManualSheet(fabPropertyId, 'task')}
                  >
                    {tTasks('smartCreate.tabTask')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={cn(
                      'flex cursor-pointer select-none items-center justify-center rounded-2xl border px-3 py-2.5 text-[13px] font-semibold leading-tight outline-none',
                      'border-[#008CA4]/40 bg-white/90 text-[#0a6b7a] shadow-sm shadow-[#008CA4]/12 backdrop-blur-md',
                      'transition-[transform,box-shadow,border-color] active:scale-[0.99]',
                      'dark:border-[#008CA4]/45 dark:bg-slate-950/65 dark:text-[#a5e9ff]',
                      'dark:shadow-[#008CA4]/15 data-[highlighted]:border-[#008CA4]/70 data-[highlighted]:bg-[#008CA4]/10',
                      'data-[highlighted]:shadow-md data-[highlighted]:shadow-[#008CA4]/20 dark:data-[highlighted]:bg-[#008CA4]/15',
                    )}
                    onSelect={() => openManualSheet(fabPropertyId, 'incident')}
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
                'bg-[#008CA4] text-white shadow-lg shadow-[#008CA4]/35',
                'transition-[box-shadow,transform] hover:bg-[#007a90] active:scale-[0.98]',
                'dark:bg-[#008CA4] dark:text-white dark:shadow-black/40',
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
