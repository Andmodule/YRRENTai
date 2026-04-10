'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import axios from 'axios';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { useLocale, useTranslations } from 'next-intl';
import { format, parseISO } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Camera,
  Clock,
  Plus,
  Package,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveModal,
  ResponsiveModalContent,
} from '@/components/ui/responsive-modal';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useDateLocale } from '@/hooks/useDateLocale';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useStaffUsers } from '@/hooks/use-staff-users';
import { cn, idEquals } from '@/lib/utils';
import { usePatchIncident, type Incident } from '@/modules/incidents/hooks/useIncidents';
import {
  incidentStatusLabelKey,
  incidentStatusUi as getIncidentStatusUi,
} from '@/modules/incidents/utils/incident-status-ui';
import { stripStaffSeedTaskMarker } from '@rentai/shared';
import {
  useMarkTaskSeen,
  usePatchTask,
  usePatchTaskChecklistItem,
  useTaskChecklist,
  useTaskNotes,
  useUpdateTaskNotes,
  useUpdateTaskStatus,
  useUploadTaskPhotos,
} from '../../hooks/useTasks';
import type { Task, TaskPriority, TaskStatus, TaskType } from '../../types';
import { AssigneePickerField } from './AssigneePickerField';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskTypeBadge } from './TaskTypeBadge';

/** В редакторе менеджера нельзя перевести задачу в issue — только pending / in_progress / done. */
const MANAGER_STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'done'];
const PRIORITY_ORDER: TaskPriority[] = ['normal', 'urgent', 'critical'];

/** Inline type picker in task detail (same labels as SmartCreateSheet, compact pills). */
const DETAIL_EDIT_TYPES: { type: TaskType; labelKey: string; shortIcon?: LucideIcon }[] = [
  { type: 'checkout_cleaning', labelKey: 'checkout_cleaning', shortIcon: ArrowDownLeft },
  { type: 'mid_stay_cleaning', labelKey: 'mid_stay_cleaning', shortIcon: RefreshCw },
  { type: 'checkin_prep', labelKey: 'checkin_prep', shortIcon: ArrowUpRight },
  { type: 'maintenance', labelKey: 'maintenance' },
  { type: 'other', labelKey: 'other' },
];

function detailTypePillClass(active: boolean) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium transition-colors md:px-3 md:py-1.5 md:text-[11px]',
    active
      ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
      : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
  );
}

const MD_UP = '(min-width: 768px)';

const TASK_PRIORITY_BADGE: Record<TaskPriority, string> = {
  normal: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  urgent: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  critical: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200',
};

/** Drawer is portaled to <body> — scope tasks cyan/teal tokens (same as `tasks/new` + kanban). */
const TASK_MODAL_THEME = 'tasks-theme';

/** Portaled shell does not inherit `.tasks-theme` from the tasks page — bind accent tokens on the modal root. */
const TASK_DETAIL_PORTAL_STYLE = {
  '--primary': 'var(--task-detail-accent)',
  '--primary-foreground': 'var(--task-detail-accent-fg)',
  '--ring': 'var(--task-detail-accent)',
} as CSSProperties;

const taskDetailFieldLabel = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';
const taskDetailSurfaceBase =
  'rounded-2xl border border-border/80 bg-muted/35 shadow-sm dark:border-border/70 dark:bg-muted/25';
const taskDetailSurface = cn(taskDetailSurfaceBase, 'p-3');
const taskTitleShell =
  'min-h-[3rem] rounded-xl border border-input bg-background px-3 py-2.5 shadow-sm dark:bg-card';
const taskTitleInputClass =
  'w-full border-none bg-transparent p-0 text-base font-semibold leading-snug text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:text-lg';
const taskNotesTextareaClass = cn(
  'min-h-[4.5rem] w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed shadow-sm outline-none transition-colors [color-scheme:dark]',
  'placeholder:text-muted-foreground/70',
  'focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
  'dark:bg-card',
);
const taskControlFocus = 'focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

function taskStickyTitle(task: Task, tType: (key: string) => string, tDetail: (key: string) => string): string {
  const pt = task.propertyTitle?.trim();
  if (pt) return pt;
  const pa = task.propertyAddress?.trim();
  if (pa) return pa;
  const typeLabel = tType(task.type);
  return typeLabel || tDetail('generalTaskFallback');
}

/** Сравнение времени: пикер даёт HH:mm, API — HH:mm:ss; нативный UI часто не вызывает blur после выбора. */
function canonicalDueTimeValue(t: string | null | undefined): string | null {
  if (t == null) return null;
  const s = String(t).trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  const ss = ((m[3] ?? '00').replace(/\D/g, '').slice(0, 2) || '00').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function dueTimesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalDueTimeValue(a) === canonicalDueTimeValue(b);
}

export type SharedDetailDrawerProps =
  | {
      mode: 'task';
      task: Task | null;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      isStaffView?: boolean;
    }
  | {
      mode: 'incident';
      incident: Incident | null;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      /** Default true (manager dashboard). */
      isManagerView?: boolean;
    };

export function SharedDetailDrawer(props: SharedDetailDrawerProps) {
  if (props.mode === 'task') {
    return (
      <TaskDetailMode
        task={props.task}
        open={props.open}
        onOpenChange={props.onOpenChange}
        isStaffView={props.isStaffView}
      />
    );
  }
  return (
    <IncidentDetailMode
      incident={props.incident}
      open={props.open}
      onOpenChange={props.onOpenChange}
      isManagerView={props.isManagerView ?? true}
    />
  );
}

function TaskDetailMode({
  task,
  open,
  onOpenChange,
  isStaffView = false,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isStaffView?: boolean;
}) {
  const t = useTranslations('tasks.detail');
  const tVoice = useTranslations('tasks.voiceCreate');
  const tStatus = useTranslations('tasks.status');
  const tPriority = useTranslations('tasks.priority');
  const tType = useTranslations('tasks.type');
  const tIssue = useTranslations('tasks.issue');
  const { user: authUser } = useAuth();
  const locale = useLocale();
  const dfLocale = locale === 'ru' ? ru : enUS;

  /** TMA sets isStaffView; staff logged into dashboard need the same UX (footer + inline issue). */
  const effectiveStaffView = isStaffView || authUser?.role === 'STAFF';
  const isDesktop = useMediaQuery(MD_UP);

  const [title, setTitle] = useState(() => task?.title ?? '');
  const [notes, setNotes] = useState(() => (task ? stripStaffSeedTaskMarker(task.notes) : ''));
  const [dueDateStr, setDueDateStr] = useState(() =>
    task?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : '',
  );
  const [dueTimeStr, setDueTimeStr] = useState(() => (task?.dueTime ? task.dueTime.slice(0, 5) : ''));
  const [issueReportOpen, setIssueReportOpen] = useState(false);
  const [issueText, setIssueText] = useState('');
  const issueFilesRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: saveNotes, isPending: notesSaving } = useUpdateTaskNotes();
  const { mutateAsync: patchTask, isPending: patchPending } = usePatchTask();
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateTaskStatus();
  const { mutateAsync: uploadPhotos, isPending: uploadPending } = useUploadTaskPhotos();
  const { mutateAsync: patchChecklistItem } = usePatchTaskChecklistItem();

  const { data: staffNotes } = useTaskNotes(task?.uuid ?? null, open && !!task && !effectiveStaffView);
  const { mutate: markSeen } = useMarkTaskSeen();
  const { data: checklistData } = useTaskChecklist(task?.uuid ?? null, open && !!task);
  const { staff, isLoading: staffLoading } = useStaffUsers({ enabled: !effectiveStaffView });

  useLayoutEffect(() => {
    if (task && open) {
      setTitle(task.title || '');
      setNotes(stripStaffSeedTaskMarker(task.notes));
      setDueDateStr(/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : '');
      setDueTimeStr(task.dueTime ? task.dueTime.slice(0, 5) : '');
      setIssueReportOpen(false);
      setIssueText('');
    }
  }, [task, open]);

  useEffect(() => {
    if (open && task && !effectiveStaffView) {
      markSeen(task.uuid);
    }
  }, [open, task?.uuid, effectiveStaffView, markSeen]);

  const resizeNotes = useCallback(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeNotes();
  }, [notes, open, resizeNotes]);

  const dateOnly = useMemo(() => {
    if (!task) return '—';
    try {
      return format(parseISO(task.dueDate), 'd MMM yyyy', { locale: dfLocale });
    } catch {
      return task.dueDate;
    }
  }, [task, dfLocale]);

  const timeStr = task?.dueTime ?? '—';

  const createdAtFormatted = useMemo(() => {
    if (!task?.createdAt) return '';
    try {
      return format(parseISO(task.createdAt), 'd.MM.yyyy, HH:mm', { locale: dfLocale });
    } catch {
      return task.createdAt;
    }
  }, [task?.createdAt, dfLocale]);

  const updatedAtFormatted = useMemo(() => {
    if (!task?.updatedAt) return '';
    try {
      return format(parseISO(task.updatedAt), 'd.MM.yyyy, HH:mm', { locale: dfLocale });
    } catch {
      return task.updatedAt;
    }
  }, [task?.updatedAt, dfLocale]);

  const showUpdatedMeta = useMemo(() => {
    if (!task?.createdAt || !task?.updatedAt) return false;
    try {
      return new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime() > 3000;
    } catch {
      return false;
    }
  }, [task?.createdAt, task?.updatedAt]);

  const managerDateDisplay = useMemo(() => {
    if (!dueDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)) return '—';
    try {
      return format(parseISO(dueDateStr), 'd.MM.yyyy', { locale: dfLocale });
    } catch {
      return dueDateStr;
    }
  }, [dueDateStr, dfLocale]);

  const managerTimeDisplay = dueTimeStr.trim() ? dueTimeStr : '—:—';

  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      el.showPicker();
    } else {
      el.focus();
    }
  };

  const openTimePicker = () => {
    const el = timeInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      el.showPicker();
    } else {
      el.focus();
    }
  };

  const onTitleBlur = async () => {
    if (!task || effectiveStaffView) return;
    const next = title.trim() || t('untitledFallback');
    if (next === (task.title || '').trim()) return;
    try {
      await patchTask({ uuid: task.uuid, title: next });
      setTitle(next);
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onNotesBlur = async () => {
    if (!task || effectiveStaffView) return;
    const cleaned = notes;
    if (cleaned === stripStaffSeedTaskMarker(task.notes)) return;
    try {
      await saveNotes({ uuid: task.uuid, notes: cleaned });
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onStatusPick = async (status: TaskStatus) => {
    if (!task || effectiveStaffView) return;
    if (status === task.status) return;
    try {
      await updateStatus({ uuid: task.uuid, status });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        toast.error(t('checklistIncomplete'));
        return;
      }
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onPriorityPick = async (priority: TaskPriority) => {
    if (!task || effectiveStaffView || priority === task.priority) return;
    try {
      await patchTask({ uuid: task.uuid, priority });
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onPatchTaskType = async (nextType: TaskType) => {
    if (!task || effectiveStaffView || nextType === task.type) return;
    try {
      await patchTask({ uuid: task.uuid, type: nextType });
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onPickAssignee = useCallback(
    async (assigneeId: string | null) => {
      if (!task || effectiveStaffView) return;
      const next = assigneeId?.trim() || null;
      const cur = task.assigneeId?.trim() || null;
      if (idEquals(next, cur)) return;
      try {
        await patchTask({ uuid: task.uuid, assigneeId: next });
      } catch (err) {
        toast.error(getApiErrorMessage(err) ?? t('saveError'));
      }
    },
    [task, effectiveStaffView, patchTask, t],
  );

  const commitDueDate = useCallback(
    async (next: string) => {
      if (!task || effectiveStaffView) return;
      const trimmed = next.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        setDueDateStr(/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : '');
        return;
      }
      if (trimmed === task.dueDate) return;
      try {
        await patchTask({ uuid: task.uuid, dueDate: trimmed });
      } catch (err) {
        toast.error(getApiErrorMessage(err) ?? t('saveError'));
        setDueDateStr(/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : '');
      }
    },
    [task, effectiveStaffView, patchTask, t],
  );

  const commitDueTime = useCallback(
    async (rawInput: string) => {
      if (!task || effectiveStaffView) return;
      const raw = rawInput.trim();
      const nextNull = raw === '' ? null : raw.slice(0, 8);
      if (dueTimesMatch(nextNull, task.dueTime)) return;
      try {
        await patchTask({ uuid: task.uuid, dueTime: nextNull });
      } catch (err) {
        toast.error(getApiErrorMessage(err) ?? t('saveError'));
        setDueTimeStr(task.dueTime ? task.dueTime.slice(0, 5) : '');
      }
    },
    [task, effectiveStaffView, patchTask, t],
  );

  const onToggleChecklist = async (itemId: string, checked: boolean) => {
    if (!task) return;
    try {
      await patchChecklistItem({ taskUuid: task.uuid, itemId, checked });
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!task || effectiveStaffView) return;
    const files = e.target.files;
    if (!files?.length) return;
    try {
      await uploadPhotos({ uuid: task.uuid, files: Array.from(files) });
      toast.success(t('photosAdded'));
    } catch {
      toast.error(t('photosUploadError'));
    }
    e.target.value = '';
  };

  const submitIssueReport = async () => {
    if (!task) return;
    const desc = issueText.trim();
    if (!desc) {
      toast.error(tIssue('description'));
      return;
    }
    try {
      const files = issueFilesRef.current?.files;
      await updateStatus({
        uuid: task.uuid,
        status: 'issue',
        issueDescription: desc,
      });
      if (files?.length) {
        await uploadPhotos({ uuid: task.uuid, files: Array.from(files) });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('saveError'));
    }
  };

  /** Шапка: только персонал — тип, статус, приоритет, срок. У менеджера тип и срок редактируются в теле панели. */
  const staffHeaderAdornment = task ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <TaskTypeBadge type={task.type} variant="dense" />
        <TaskStatusBadge status={task.status} size="sm" />
        <span
          className={cn(
            'inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium leading-tight sm:text-xs',
            TASK_PRIORITY_BADGE[task.priority],
          )}
        >
          {tPriority(task.priority)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">{t('duePrefix')}</span>{' '}
        {dateOnly}
        {task.dueTime ? ` · ${task.dueTime}` : ''}
      </p>
    </div>
  ) : null;

  const checklistItems = checklistData?.items ?? [];
  const headerDisabled = effectiveStaffView || patchPending;

  const staffFooter = (() => {
    if (!task) return null;
    if (!effectiveStaffView) return null;
    if (issueReportOpen) {
      return (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setIssueReportOpen(false);
            setIssueText('');
          }}
        >
          {tIssue('cancel')}
        </Button>
      );
    }
    if (task.status === 'pending') {
      return (
        <Button
          type="button"
          className="w-full"
          disabled={statusPending}
          onClick={() => void updateStatus({ uuid: task.uuid, status: 'in_progress' })}
        >
          {t('staffTakeWork')}
        </Button>
      );
    }
    if (task.status === 'in_progress') {
      return (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={statusPending}
            onClick={() => void updateStatus({ uuid: task.uuid, status: 'done' })}
          >
            {t('staffComplete')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={() => {
              setIssueReportOpen(true);
              setIssueText('');
            }}
          >
            {t('staffReportIssue')}
          </Button>
        </div>
      );
    }
    return (
      <Button type="button" variant="secondary" className="w-full" onClick={() => onOpenChange(false)}>
        {t('close')}
      </Button>
    );
  })();

  /*
   * Резерв: нижняя кнопка «Сохранить / Закрыть» для менеджера (сейчас не показываем — автосохранение).
   * Вернуть в ResponsiveModalContent: footer={
   *   !effectiveStaffView && task ? (
   *     <div className="pb-safe">
   *       <Button type="button" variant="secondary" className="h-10 w-full" onClick={() => { blur active; onOpenChange(false); }}>
   *         {t('saveClose')}
   *       </Button>
   *     </div>
   *   ) : ...
   * }
   */

  const modalFooter =
    effectiveStaffView && staffFooter ? (
      <div className="pb-safe">{staffFooter}</div>
    ) : undefined;

  if (!task) {
    return null;
  }

  const panelTitle =
    task.propertyTitle?.trim() || taskStickyTitle(task, (k) => tType(k), (k) => t(k));
  const headerDescription =
    task.propertyTitle?.trim() && task.propertyAddress?.trim()
      ? task.propertyAddress.trim()
      : undefined;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
      <ResponsiveModalContent
        title={panelTitle}
        description={headerDescription}
        headerAdornment={effectiveStaffView ? staffHeaderAdornment : undefined}
        hideCloseButton={!isDesktop}
        contentStyle={TASK_DETAIL_PORTAL_STYLE}
        className={cn(
          TASK_MODAL_THEME,
          'flex w-full max-w-xl flex-col rounded-t-2xl sm:max-w-xl sm:rounded-xl',
          'max-h-[85vh] md:max-h-none md:min-h-0 md:h-full md:rounded-none md:rounded-l-2xl',
        )}
        bodyClassName="border-t border-border/50 px-4 pt-4 pb-4 max-md:border-t-0 max-md:px-4 max-md:pb-2"
        footer={modalFooter}
      >
        <div className="detail-scroll-body flex flex-col gap-[var(--space-4,1rem)] max-md:gap-3">
          <div className="space-y-1.5 max-md:space-y-2">
            <p className={taskDetailFieldLabel}>{t('taskTitleLabel')}</p>
            {effectiveStaffView ? (
              <div
                className={cn(
                  taskTitleShell,
                  'py-3 max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:shadow-none',
                )}
              >
                <h2 className="text-base font-semibold leading-snug tracking-tight text-foreground max-md:text-[1.125rem] max-md:leading-relaxed sm:text-lg">
                  {task.title?.trim() ? task.title : t('untitledFallback')}
                </h2>
              </div>
            ) : (
              <div
                className={cn(
                  taskTitleShell,
                  'max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:shadow-none',
                )}
              >
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void onTitleBlur()}
                  disabled={patchPending}
                  placeholder={t('untitledFallback')}
                  className={cn(
                    taskTitleInputClass,
                    'max-md:text-[1.125rem] max-md:leading-relaxed',
                    patchPending && 'pointer-events-none opacity-60',
                  )}
                  aria-label={t('taskTitleAria')}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/15 p-2.5 shadow-sm dark:border-border/60 dark:bg-muted/20 sm:p-3">
            <label htmlFor="task-manager-note" className={taskDetailFieldLabel}>
              {t('managerNote')}
            </label>
            <textarea
              id="task-manager-note"
              ref={notesRef}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                requestAnimationFrame(resizeNotes);
              }}
              onBlur={() => void onNotesBlur()}
              readOnly={effectiveStaffView}
              disabled={notesSaving}
              rows={2}
              placeholder={t('managerNotePlaceholder')}
              className={cn(
                taskNotesTextareaClass,
                'border-border/60 bg-background/80 dark:bg-card/80',
                effectiveStaffView && 'cursor-default opacity-90',
              )}
            />
          </div>

          {!effectiveStaffView && (
            <div className="space-y-1.5">
              <p className={taskDetailFieldLabel}>{t('type')}</p>
              <div className="flex flex-wrap gap-1">
                {DETAIL_EDIT_TYPES.map(({ type: tt, labelKey, shortIcon: ShortIcon }) => (
                  <button
                    key={tt}
                    type="button"
                    disabled={patchPending}
                    onClick={() => void onPatchTaskType(tt)}
                    className={cn(
                      detailTypePillClass(task.type === tt),
                      patchPending && 'pointer-events-none opacity-60',
                    )}
                  >
                    <span className="inline-flex max-w-[9rem] items-center gap-1 truncate sm:max-w-none">
                      {ShortIcon ? (
                        <ShortIcon
                          className="h-3 w-3 shrink-0 stroke-[2.25] text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                      <span className="truncate">{tType(labelKey)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!effectiveStaffView && (
            <div className="space-y-1.5">
              <p className={taskDetailFieldLabel}>{t('status')}</p>
              <div className="flex flex-wrap gap-1">
                {MANAGER_STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={headerDisabled || statusPending}
                    onClick={() => void onStatusPick(s)}
                    className={cn(
                      detailTypePillClass(task.status === s),
                      (headerDisabled || statusPending) && 'pointer-events-none opacity-60',
                    )}
                  >
                    {tStatus(s)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!effectiveStaffView && (
            <div className="space-y-1.5">
              <p className={taskDetailFieldLabel}>{t('assignee')}</p>
              <AssigneePickerField
                variant="compact"
                staff={staff}
                value={task.assigneeId}
                fallbackName={task.assigneeName?.trim() ? task.assigneeName : null}
                loading={staffLoading}
                disabled={patchPending}
                onChange={(id) => void onPickAssignee(id)}
              />
            </div>
          )}

          {!effectiveStaffView && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
              <span className={taskDetailFieldLabel}>{t('dueDate')}</span>
              <button
                type="button"
                disabled={patchPending}
                onClick={openDatePicker}
                className="border-0 bg-transparent p-0 font-medium tabular-nums text-foreground underline-offset-2 hover:underline disabled:opacity-60"
              >
                {managerDateDisplay}
              </button>
              <button
                type="button"
                disabled={patchPending}
                onClick={openDatePicker}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                aria-label={t('dueDate')}
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden />
              </button>
              <input
                ref={dateInputRef}
                type="date"
                value={dueDateStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setDueDateStr(v);
                  void commitDueDate(v);
                }}
                onBlur={(e) => void commitDueDate(e.target.value)}
                disabled={patchPending}
                className="sr-only"
                tabIndex={-1}
              />
              <span className="text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <span className={taskDetailFieldLabel}>{t('dueTime')}</span>
              <button
                type="button"
                disabled={patchPending}
                onClick={openTimePicker}
                className="border-0 bg-transparent p-0 font-medium tabular-nums text-foreground underline-offset-2 hover:underline disabled:opacity-60"
              >
                {managerTimeDisplay}
              </button>
              <button
                type="button"
                disabled={patchPending}
                onClick={openTimePicker}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                aria-label={t('dueTime')}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
              </button>
              <input
                ref={timeInputRef}
                type="time"
                value={dueTimeStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setDueTimeStr(v);
                  void commitDueTime(v);
                }}
                onBlur={(e) => void commitDueTime(e.target.value)}
                disabled={patchPending}
                className="sr-only"
                tabIndex={-1}
              />
            </div>
          )}

          {!effectiveStaffView && (
            <div className="space-y-1.5">
              <p className={taskDetailFieldLabel}>{tVoice('priorityLabel')}</p>
              <div className="flex flex-wrap gap-1">
                {PRIORITY_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={patchPending}
                    onClick={() => void onPriorityPick(p)}
                    className={cn(
                      detailTypePillClass(task.priority === p),
                      patchPending && 'pointer-events-none opacity-60',
                    )}
                  >
                    {tPriority(p)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {task.status === 'issue' && task.issueDescription ? (
            <div
              className="rounded-xl border border-red-500/25 bg-red-50/90 p-3 text-sm text-red-950 dark:bg-red-950/20 dark:text-red-100"
              role="alert"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">
                {t('issueBlockTitle')}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{task.issueDescription}</p>
            </div>
          ) : null}

          {task.contextLabel ? (
            <p className="rounded-md border border-cyan-200/80 bg-cyan-50/90 px-2.5 py-2 text-xs leading-snug text-cyan-950 dark:border-cyan-500/35 dark:bg-cyan-950/45 dark:text-cyan-100">
              {task.contextLabel}
            </p>
          ) : null}

          {checklistItems.length > 0 && (
            <div
              className={cn(
                'space-y-2',
                taskDetailSurface,
                'max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none',
              )}
            >
              <p className={taskDetailFieldLabel}>{t('checklist')}</p>
              <ul className="space-y-2">
                {checklistItems.map((item) => (
                  <li key={item.uuid} className="flex items-start gap-2">
                    <Checkbox
                      id={`chk-${item.uuid}`}
                      checked={item.checked}
                      disabled={effectiveStaffView}
                      onCheckedChange={(c) => void onToggleChecklist(item.uuid, c === true)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <label
                      htmlFor={`chk-${item.uuid}`}
                      className={cn(
                        'text-sm leading-snug',
                        item.checked && 'text-muted-foreground line-through',
                        item.required && 'font-medium',
                      )}
                    >
                      {item.text}
                      {item.required ? (
                        <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">
                          ({t('required')})
                        </span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(task.photoUrls.length > 0 || !effectiveStaffView) && (
            <div
              className={cn(
                'space-y-2',
                taskDetailSurface,
                'max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none',
              )}
            >
              {!effectiveStaffView && task.photoUrls.length === 0 ? (
                <div className="flex items-center gap-2">
                  <p className={taskDetailFieldLabel}>{t('photos')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={uploadPending}
                    onClick={() => fileRef.current?.click()}
                    aria-label={t('addPhoto')}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <>
                  <p className={taskDetailFieldLabel}>{t('photos')}</p>
                  <div className="grid grid-cols-4 gap-2 max-md:flex max-md:flex-nowrap max-md:gap-2 max-md:overflow-x-auto max-md:pb-1.5 [-webkit-overflow-scrolling:touch]">
                    {task.photoUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative aspect-square w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted max-md:h-20 max-md:w-20 max-md:max-w-[5rem]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- external URLs */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                    {!effectiveStaffView && (
                      <button
                        type="button"
                        disabled={uploadPending}
                        onClick={() => fileRef.current?.click()}
                        title={t('addPhoto')}
                        aria-label={t('addPhoto')}
                        className="flex aspect-square w-full shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/40 bg-muted/15 text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-50 max-md:h-20 max-md:w-20 max-md:max-w-[5rem]"
                      >
                        <Plus className="h-5 w-5 opacity-80" aria-hidden />
                      </button>
                    )}
                  </div>
                </>
              )}
              {(task.hasVerificationPhoto ?? false) && (
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t('verifiedPhoto')}</p>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
            </div>
          )}

          {!effectiveStaffView && staffNotes && staffNotes.length > 0 && (
            <div className="rounded-lg border border-amber-200/90 bg-amber-50/95 p-2.5 dark:border-amber-800/55 dark:bg-amber-950/45">
              <p className="mb-1.5 text-xs font-medium text-amber-950 dark:text-amber-100">{t('staffNotesTitle')}</p>
              <ul className="space-y-2 text-sm">
                {staffNotes.map((n) => (
                  <li key={n.uuid} className="border-b border-amber-200/70 pb-2 last:border-0 dark:border-amber-800/45">
                    <span className="text-xs text-amber-800/90 dark:text-amber-200/85">{n.authorName}</span>
                    <p className="text-amber-950 dark:text-amber-50">{n.text}</p>
                    {n.photoUrl && (
                      <a href={n.photoUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        {t('staffNotePhoto')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3.5">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span>{t('creator')}</span>
                {': '}
                <span className="text-muted-foreground/90">
                  {task.creatorName?.trim() ? task.creatorName : '—'}
                </span>
                {showUpdatedMeta && updatedAtFormatted ? (
                  <>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                    <span>{t('metaUpdated', { time: updatedAtFormatted })}</span>
                  </>
                ) : createdAtFormatted ? (
                  <>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                    <span>{t('metaCreated', { time: createdAtFormatted })}</span>
                  </>
                ) : null}
              </p>

              {effectiveStaffView && (
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div className="min-w-0 space-y-1">
                    <span className={taskDetailFieldLabel}>{t('dueDate')}</span>
                    <span className="block text-sm font-medium tabular-nums text-foreground">{dateOnly}</span>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <span className={taskDetailFieldLabel}>{t('dueTime')}</span>
                    <span className="block text-sm font-medium tabular-nums text-foreground">{timeStr}</span>
                  </div>
                </div>
              )}
          </div>

          {effectiveStaffView && task.status === 'in_progress' && (
            <Collapsible open={issueReportOpen} onOpenChange={setIssueReportOpen}>
              <CollapsibleContent>
                <div className="mt-0 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                  <Label htmlFor="issue-report-text" className="text-sm font-medium text-destructive">
                    {tIssue('title')}
                  </Label>
                  <Textarea
                    id="issue-report-text"
                    required
                    autoFocus
                    value={issueText}
                    onChange={(e) => setIssueText(e.target.value)}
                    placeholder={tIssue('placeholder')}
                    rows={4}
                    className="rounded-lg border border-input bg-background shadow-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 dark:bg-card"
                  />
                  <input ref={issueFilesRef} type="file" accept="image/*" multiple className="hidden" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => issueFilesRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    {tIssue('photos')}
                  </Button>
                  <Button
                    type="button"
                    className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={statusPending || uploadPending}
                    onClick={() => void submitIssueReport()}
                  >
                    {tIssue('submit')}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function IncidentDetailMode({
  incident,
  open,
  onOpenChange,
  isManagerView,
}: {
  incident: Incident | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isManagerView: boolean;
}) {
  const t = useTranslations('tasks.kanban.incidentDetail');
  const tCard = useTranslations('tasks.kanban.incidentCard');
  const tDetail = useTranslations('tasks.detail');
  const dateLocale = useDateLocale();
  const isDesktop = useMediaQuery(MD_UP);
  const { mutate: patch, isPending } = usePatchIncident();
  const [managerNote, setManagerNote] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');

  useEffect(() => {
    if (incident && open) {
      setManagerNote(incident.managerNote ?? '');
      setEstimatedCost(incident.estimatedCost ?? '');
    }
  }, [incident, open]);

  const onManagerNoteBlur = () => {
    if (!incident || !isManagerView) return;
    const next = managerNote.trim() || null;
    if (next === (incident.managerNote ?? null)) return;
    patch(
      { uuid: incident.uuid, managerNote: next },
      {
        onError: () => toast.error(tDetail('saveError')),
      },
    );
  };

  const onCostBlur = () => {
    if (!incident || !isManagerView || incident.type === 'lost_item') return;
    const next = estimatedCost.trim() || null;
    if (next === (incident.estimatedCost ?? null)) return;
    patch(
      { uuid: incident.uuid, estimatedCost: next },
      {
        onError: () => toast.error(tDetail('saveError')),
      },
    );
  };

  if (!incident) {
    return null;
  }

  const created = format(new Date(incident.createdAt), 'd MMMM yyyy, HH:mm', { locale: dateLocale });
  const stickyTitle =
    incident.propertyTitle?.trim() || incident.propertyAddress?.trim() || tCard('badge');
  const headerDescription =
    incident.propertyTitle?.trim() && incident.propertyAddress?.trim()
      ? incident.propertyAddress.trim()
      : t('subtitle');

  const lastPhone = incident.lastStayGuestPhone?.trim();
  const lastPhoneDigits = lastPhone ? lastPhone.replace(/\D/g, '') : '';
  const telHref = lastPhone ? `tel:${lastPhone.replace(/\s/g, '')}` : '';

  const patchStatus = (status: Incident['status']) => {
    patch(
      { uuid: incident.uuid, status },
      {
        onSuccess: (updated) => {
          if (updated.status === 'resolved' || updated.status === 'closed') {
            onOpenChange(false);
          }
        },
        onError: () => toast.error(tDetail('saveError')),
      },
    );
  };

  const incidentStatusVisual = getIncidentStatusUi(incident.status);

  const typeBadge = (() => {
    switch (incident.type) {
      case 'damage':
        return {
          Icon: AlertTriangle,
          className: 'bg-destructive/15 text-destructive',
          label: t('typeDamage'),
        };
      case 'lost_item':
        return {
          Icon: Package,
          className: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
          label: t('typeLost'),
        };
      case 'rule_violation':
        return {
          Icon: ShieldAlert,
          className: 'bg-orange-500/15 text-orange-950 dark:text-orange-100',
          label: t('typeRuleViolation'),
        };
      case 'emergency':
        return {
          Icon: Zap,
          className: 'bg-violet-500/20 text-violet-950 dark:text-violet-100',
          label: t('typeEmergency'),
        };
      case 'task_report':
        return {
          Icon: ClipboardList,
          className: 'bg-sky-500/15 text-sky-950 dark:text-sky-100',
          label: t('typeTaskReport'),
        };
    }
  })();

  const TypeIcon = typeBadge.Icon;

  const headerAdornment = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
            typeBadge.className,
          )}
        >
          <TypeIcon className="h-3.5 w-3.5" />
          {typeBadge.label}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
            incidentStatusVisual.pill,
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', incidentStatusVisual.dot)}
            aria-hidden
          />
          {tCard(incidentStatusLabelKey(incident.status))}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">{tDetail('reportedPrefix')}</span> {created}
      </p>
    </div>
  );

  const showBookingCard =
    !!incident.guestName?.trim() ||
    !!incident.reservationId ||
    !!(incident.lastStayGuestName || incident.lastStayGuestPhone || incident.lastStayCheckOut);

  const incidentFooter = (() => {
    if (!isManagerView) {
      return null;
    }
    if (
      incident.status === 'awaiting_dispatch' ||
      incident.status === 'assigned' ||
      incident.status === 'open' ||
      incident.status === 'in_review'
    ) {
      return (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={isPending}
          onClick={() => patchStatus('resolved')}
        >
          {t('markResolved')}
        </Button>
      );
    }
    if (incident.status === 'resolved' || incident.status === 'closed') {
      return (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={isPending}
          onClick={() =>
            patch(
              { uuid: incident.uuid, status: 'in_review' },
              { onError: () => toast.error(tDetail('saveError')) },
            )
          }
        >
          {tDetail('reopenIncident')}
        </Button>
      );
    }
    return null;
  })();

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
      <ResponsiveModalContent
        title={stickyTitle}
        description={headerDescription}
        headerAdornment={headerAdornment}
        hideCloseButton={!isDesktop}
        contentStyle={TASK_DETAIL_PORTAL_STYLE}
        className={cn(
          TASK_MODAL_THEME,
          'flex w-full max-w-xl flex-col rounded-t-2xl sm:max-w-xl sm:rounded-xl',
          'max-h-[85vh] md:max-h-none md:min-h-0 md:h-full md:rounded-none md:rounded-l-2xl',
        )}
        bodyClassName="border-t border-border/50 px-4 pt-4 pb-4 max-md:border-t-0 max-md:px-4 max-md:pb-2"
        footer={
          incidentFooter ? (
            <div className="pb-safe">{incidentFooter}</div>
          ) : undefined
        }
      >
        <div className="detail-scroll-body flex flex-col gap-[var(--space-4,1rem)] max-md:gap-3">
          {incident.reporterName ? (
            <div className="space-y-1.5">
              <p className={taskDetailFieldLabel}>{t('reporter')}</p>
              <div
                className={cn(
                  taskTitleShell,
                  'max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:shadow-none',
                )}
              >
                <p className="text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg">
                  {incident.reporterName}
                </p>
              </div>
            </div>
          ) : null}

            <div
              className={cn(
                taskDetailSurfaceBase,
                'p-3 text-sm shadow-sm',
                incident.type === 'damage' &&
                  'border-red-500/35 bg-red-50/80 text-red-950 dark:border-red-500/25 dark:bg-red-950/15 dark:text-red-100',
                incident.type === 'lost_item' &&
                  'border-amber-500/35 bg-amber-50/80 text-amber-950 dark:border-amber-500/25 dark:bg-amber-950/20 dark:text-amber-50',
                incident.type === 'rule_violation' &&
                  'border-orange-500/35 bg-orange-50/85 text-orange-950 dark:border-orange-500/25 dark:bg-orange-950/25 dark:text-orange-50',
                incident.type === 'emergency' &&
                  'border-violet-500/40 bg-violet-50/90 text-violet-950 dark:border-violet-500/30 dark:bg-violet-950/30 dark:text-violet-50',
                incident.type === 'task_report' &&
                  'border-sky-500/35 bg-sky-50/85 text-sky-950 dark:border-sky-500/25 dark:bg-sky-950/25 dark:text-sky-50',
              )}
            >
              <p className="whitespace-pre-wrap">{incident.description}</p>
            </div>

            {showBookingCard ? (
              <div className="rounded-xl border border-border/60 bg-card p-3 text-sm shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">{t('lastStayTitle')}</p>
                {incident.guestName ? (
                  <p className="mt-1">
                    <span className="text-muted-foreground">{t('guest')}</span> {incident.guestName}
                  </p>
                ) : null}
                {incident.reservationId ? (
                  <p className="mt-1 text-xs text-muted-foreground">ID: {incident.reservationId}</p>
                ) : null}
                {incident.lastStayGuestName || lastPhone || incident.lastStayCheckOut ? (
                  <div className="mt-2 space-y-1">
                    {incident.lastStayGuestName ? (
                      <p>
                        <span className="text-muted-foreground">{t('lastStayGuest')}</span>{' '}
                        <span className="font-medium">{incident.lastStayGuestName}</span>
                      </p>
                    ) : null}
                    {incident.lastStayCheckOut ? (
                      <p className="text-muted-foreground">
                        {t('lastStayCheckOutLabel')}{' '}
                        {format(new Date(incident.lastStayCheckOut), 'd MMMM yyyy', { locale: dateLocale })}
                      </p>
                    ) : null}
                    {lastPhoneDigits && telHref ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button type="button" variant="secondary" size="sm" asChild>
                          <a href={telHref}>{t('contactCall')}</a>
                        </Button>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={`https://wa.me/${lastPhoneDigits}`} target="_blank" rel="noopener noreferrer">
                            {t('contactWhatsApp')}
                          </a>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : !incident.guestName && !incident.reservationId ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t('lastStayEmpty')}</p>
                ) : null}
              </div>
            ) : null}

            {(incident.itemDescription || incident.damageLocation) && (
              <dl className="grid gap-2 text-sm">
                {incident.itemDescription ? (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('item')}</dt>
                    <dd>{incident.itemDescription}</dd>
                  </div>
                ) : null}
                {incident.damageLocation ? (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t('location')}</dt>
                    <dd>{incident.damageLocation}</dd>
                  </div>
                ) : null}
              </dl>
            )}

            {incident.photoUrls?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('photos')}</p>
                <div className="flex flex-wrap gap-2">
                  {incident.photoUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-24 w-24 object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {isManagerView && (
              <>
                <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/15 p-2.5 shadow-sm dark:border-border/60 dark:bg-muted/20 sm:p-3">
                  <label htmlFor="incident-note" className={taskDetailFieldLabel}>
                    {t('managerNote')}
                  </label>
                  <Textarea
                    id="incident-note"
                    value={managerNote}
                    onChange={(e) => setManagerNote(e.target.value)}
                    onBlur={() => onManagerNoteBlur()}
                    rows={3}
                    placeholder={t('managerNotePlaceholder')}
                    className={cn(
                      taskNotesTextareaClass,
                      'border-border/60 bg-background/80 dark:bg-card/80',
                    )}
                  />
                </div>
                {incident.type === 'damage' && (
                  <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/15 p-2.5 shadow-sm dark:border-border/60 dark:bg-muted/20 sm:p-3">
                    <label htmlFor="incident-cost" className={taskDetailFieldLabel}>
                      {t('estimatedCost')}
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        id="incident-cost"
                        value={estimatedCost}
                        onChange={(e) => setEstimatedCost(e.target.value)}
                        onBlur={() => onCostBlur()}
                        placeholder={t('estimatedCostPlaceholder')}
                        className={cn(
                          'border-border/60 bg-background/80 pl-8 dark:bg-card/80',
                          taskControlFocus,
                        )}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>
  );
}
