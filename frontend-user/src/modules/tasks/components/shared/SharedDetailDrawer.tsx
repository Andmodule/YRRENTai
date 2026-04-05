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
import { useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import axios from 'axios';
import { useLocale, useTranslations } from 'next-intl';
import { format, parseISO } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import {
  AlertTriangle,
  Camera,
  Clock,
  ImagePlus,
  MapPin,
  Package,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';
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
import { useProperties } from '@/hooks/use-properties';
import { useStaffUsers } from '@/hooks/use-staff-users';
import { cn } from '@/lib/utils';
import { usePatchIncident, type Incident } from '@/modules/incidents/hooks/useIncidents';
import {
  incidentStatusLabelKey,
  incidentStatusUi as getIncidentStatusUi,
} from '@/modules/incidents/utils/incident-status-ui';
import { VoiceTaskCreateSheet } from '@/modules/tasks/components/manager/VoiceTaskCreateSheet';
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
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { formatNameAndLastInitial } from '../../utils/staff-name-short';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskTypeBadge } from './TaskTypeBadge';

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'done', 'issue'];
const PRIORITY_ORDER: TaskPriority[] = ['normal', 'urgent', 'critical'];

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
  const tStatus = useTranslations('tasks.status');
  const tPriority = useTranslations('tasks.priority');
  const tType = useTranslations('tasks.type');
  const tIssue = useTranslations('tasks.issue');
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const locale = useLocale();
  const dfLocale = locale === 'ru' ? ru : enUS;

  /** TMA sets isStaffView; staff logged into dashboard need the same UX (footer + inline issue). */
  const effectiveStaffView = isStaffView || authUser?.role === 'STAFF';

  const [title, setTitle] = useState(() => task?.title ?? '');
  const [notes, setNotes] = useState(() => (task ? stripStaffSeedTaskMarker(task.notes) : ''));
  const [issueReportOpen, setIssueReportOpen] = useState(false);
  const [issueText, setIssueText] = useState('');
  const issueFilesRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: saveNotes, isPending: notesSaving } = useUpdateTaskNotes();
  const { mutateAsync: patchTask, isPending: patchPending } = usePatchTask();
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateTaskStatus();
  const { mutateAsync: uploadPhotos, isPending: uploadPending } = useUploadTaskPhotos();
  const { mutateAsync: patchChecklistItem } = usePatchTaskChecklistItem();

  const { data: staffNotes } = useTaskNotes(task?.uuid ?? null, open && !!task && !effectiveStaffView);
  const { mutate: markSeen } = useMarkTaskSeen();
  const { data: checklistData } = useTaskChecklist(task?.uuid ?? null, open && !!task);
  const { properties } = useProperties({ enabled: !effectiveStaffView });
  const { staff } = useStaffUsers({ enabled: !effectiveStaffView });

  useLayoutEffect(() => {
    if (task && open) {
      setTitle(task.title || '');
      setNotes(stripStaffSeedTaskMarker(task.notes));
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

  const stickyTitle = task ? taskStickyTitle(task, (k) => tType(k), (k) => t(k)) : '';

  const onTitleBlur = async () => {
    if (!task || effectiveStaffView) return;
    const next = title.trim() || t('untitledFallback');
    if (next === (task.title || '').trim()) return;
    try {
      await patchTask({ uuid: task.uuid, title: next });
      setTitle(next);
    } catch {
      toast.error(t('saveError'));
    }
  };

  const onNotesBlur = async () => {
    if (!task || effectiveStaffView) return;
    const cleaned = notes;
    if (cleaned === stripStaffSeedTaskMarker(task.notes)) return;
    try {
      await saveNotes({ uuid: task.uuid, notes: cleaned });
    } catch {
      toast.error(t('saveError'));
    }
  };

  const onStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!task || effectiveStaffView) return;
    const status = e.target.value as TaskStatus;
    try {
      await updateStatus({ uuid: task.uuid, status });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        toast.error(t('checklistIncomplete'));
        return;
      }
      toast.error(t('saveError'));
    }
  };

  const onPriorityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!task || effectiveStaffView) return;
    const priority = e.target.value as TaskPriority;
    try {
      await patchTask({ uuid: task.uuid, priority });
    } catch {
      toast.error(t('saveError'));
    }
  };

  const onPickProperty = async (propertyId: string) => {
    if (!task || effectiveStaffView || propertyId === task.propertyId) return;
    try {
      await patchTask({ uuid: task.uuid, propertyId });
    } catch {
      toast.error(t('saveError'));
    }
  };

  const onPickAssignee = async (assigneeId: string | null) => {
    if (!task || effectiveStaffView) return;
    if (assigneeId === task.assigneeId) return;
    try {
      await patchTask({ uuid: task.uuid, assigneeId });
    } catch {
      toast.error(t('saveError'));
    }
  };

  const onToggleChecklist = async (itemId: string, checked: boolean) => {
    if (!task) return;
    try {
      await patchChecklistItem({ taskUuid: task.uuid, itemId, checked });
    } catch {
      toast.error(t('saveError'));
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
    } catch {
      toast.error(t('saveError'));
    }
  };

  const headerAdornment = task ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <TaskTypeBadge type={task.type} variant="dense" />
        <TaskStatusBadge status={task.status} size="sm" />
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

  const taskFooter = (() => {
    if (!task) return null;
    if (effectiveStaffView) {
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
    }
    return (
      <div className="flex w-full flex-col gap-2.5">
        <Button
          type="button"
          variant="default"
          className="h-auto min-h-12 w-full rounded-xl py-3 text-base font-semibold shadow-sm"
          asChild
        >
          <Link href={`/dashboard/tasks/new?propertyId=${encodeURIComponent(task.propertyId ?? '')}`}>
            {t('editTask')}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-12 w-full rounded-xl border-border/80 py-3 text-base"
          onClick={() => onOpenChange(false)}
        >
          {t('close')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-auto min-h-12 w-full rounded-xl py-3 text-base"
          onClick={() => {
            if (typeof window !== 'undefined' && !window.confirm(t('deleteTaskConfirm'))) return;
            void (async () => {
              try {
                await apiClient.delete(`/tasks/${task.uuid}`);
                await queryClient.invalidateQueries({ queryKey: ['tasks'] });
                onOpenChange(false);
                toast.success(t('deleteTaskSuccess'));
              } catch {
                toast.error(t('deleteTaskError'));
              }
            })();
          }}
        >
          {t('deleteTask')}
        </Button>
      </div>
    );
  })();

  if (!task) {
    return null;
  }

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        title={stickyTitle}
        headerAdornment={headerAdornment}
        contentStyle={TASK_DETAIL_PORTAL_STYLE}
        className={cn(
          TASK_MODAL_THEME,
          'flex max-h-[min(92dvh,92vh)] w-full max-w-xl flex-col rounded-t-2xl sm:max-w-xl sm:rounded-xl',
        )}
        bodyClassName="border-t border-border/50 px-4 pt-4 pb-4"
        footer={<div className="pb-safe">{taskFooter}</div>}
      >
        <div className="detail-scroll-body flex flex-col gap-[var(--space-4,1rem)]">
          <div className="space-y-1.5">
            <p className={taskDetailFieldLabel}>{t('taskTitleLabel')}</p>
            {effectiveStaffView ? (
              <div className={cn(taskTitleShell, 'py-3')}>
                <h2 className="text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg">
                  {task.title?.trim() ? task.title : t('untitledFallback')}
                </h2>
              </div>
            ) : (
              <div className={taskTitleShell}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void onTitleBlur()}
                  disabled={patchPending}
                  placeholder={t('untitledFallback')}
                  className={cn(taskTitleInputClass, patchPending && 'pointer-events-none opacity-60')}
                  aria-label={t('taskTitleAria')}
                />
              </div>
            )}
          </div>

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
            <div className={cn('space-y-2', taskDetailSurface)}>
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

          <div className={cn('space-y-2', taskDetailSurface)}>
            <p className={taskDetailFieldLabel}>{t('photos')}</p>
            <div className="grid grid-cols-4 gap-2">
              {task.photoUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
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
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-muted/15 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-50"
                >
                  <ImagePlus className="h-5 w-5 opacity-70" aria-hidden />
                  <span className="px-0.5 text-center leading-tight">{t('addPhoto')}</span>
                </button>
              )}
            </div>
            {(task.hasVerificationPhoto ?? false) && (
              <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t('verifiedPhoto')}</p>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
          </div>

          <div className="space-y-1.5">
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
                effectiveStaffView && 'cursor-default opacity-90',
              )}
            />
          </div>

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

          <div className={cn(taskDetailSurfaceBase, 'border-l-[3px] border-l-primary p-4')}>
            {!effectiveStaffView && (
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border/50 pb-4">
                <select
                  aria-label={t('status')}
                  disabled={headerDisabled}
                  value={task.status}
                  onChange={onStatusChange}
                  className={cn(
                    'h-9 max-w-[11rem] appearance-none rounded-full border border-input bg-background py-1.5 pl-3 pr-2 text-xs font-medium shadow-sm',
                    taskControlFocus,
                    headerDisabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('priority')}
                  disabled={headerDisabled}
                  value={task.priority}
                  onChange={onPriorityChange}
                  className={cn(
                    'h-9 rounded-full border border-input bg-background px-2.5 text-xs font-medium shadow-sm',
                    taskControlFocus,
                    headerDisabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2.5 text-sm">
              <dt className={taskDetailFieldLabel}>{t('property')}</dt>
              <dd className="min-w-0">
                {effectiveStaffView ? (
                  <span className="inline-flex max-w-full truncate rounded-md border border-input bg-background px-2 py-1 text-sm font-medium shadow-sm">
                    {task.propertyTitle}
                  </span>
                ) : (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        disabled={patchPending}
                        className={cn(
                          'inline-flex max-w-full items-center gap-1 truncate rounded-md border border-input bg-background px-2 py-1 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted',
                          taskControlFocus,
                          'disabled:opacity-50',
                        )}
                      >
                        {task.propertyTitle}
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        sideOffset={6}
                        align="start"
                        className="z-[200] max-h-[min(280px,45vh)] min-w-[10rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      >
                        {properties.map((p) => (
                          <DropdownMenu.Item
                            key={p.id}
                            onSelect={() => void onPickProperty(p.id)}
                            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                          >
                            {p.name}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </dd>

              {!effectiveStaffView && (
                <>
                  <dt className={taskDetailFieldLabel}>{t('assignee')}</dt>
                  <dd className="min-w-0">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          disabled={patchPending}
                          className={cn(
                            'inline-flex max-w-full items-center gap-2 rounded-md border border-input bg-background py-0.5 pl-1 pr-2 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted',
                            taskControlFocus,
                            'disabled:opacity-50',
                          )}
                        >
                          <span className="inline-flex h-7 min-w-7 max-w-[5.5rem] shrink-0 items-center justify-center truncate rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                            {task.assigneeName ? formatNameAndLastInitial(task.assigneeName) : '?'}
                          </span>
                          <span className="truncate">{task.assigneeName ?? t('unassigned')}</span>
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          sideOffset={6}
                          align="start"
                          className="z-[200] max-h-[min(280px,45vh)] min-w-[12rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                        >
                          <DropdownMenu.Item
                            onSelect={() => void onPickAssignee(null)}
                            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                          >
                            {t('unassigned')}
                          </DropdownMenu.Item>
                          {staff.map((s) => (
                            <DropdownMenu.Item
                              key={s.id}
                              onSelect={() => void onPickAssignee(s.id)}
                              className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                            >
                              {s.displayName}
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </dd>
                </>
              )}

              <dt className={taskDetailFieldLabel}>{t('creator')}</dt>
              <dd className="text-sm font-medium text-foreground">
                {task.creatorName?.trim() ? task.creatorName : '—'}
              </dd>

              <dt className={taskDetailFieldLabel}>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3 opacity-70" aria-hidden />
                  {t('dueDate')}
                </span>
              </dt>
              <dd className="text-sm font-medium tabular-nums text-foreground">{dateOnly}</dd>

              <dt className={taskDetailFieldLabel}>{t('dueTime')}</dt>
              <dd className="text-sm font-medium tabular-nums text-foreground">{timeStr}</dd>

              <dt className={taskDetailFieldLabel}>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 opacity-70" aria-hidden />
                  {t('location')}
                </span>
              </dt>
              <dd className="text-sm leading-snug text-foreground">{task.propertyAddress}</dd>
            </dl>
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
  const { mutate: patch, isPending } = usePatchIncident();
  const [managerNote, setManagerNote] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);

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
    if (incident.status === 'open' || incident.status === 'in_review') {
      return (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            className="w-full"
            disabled={isPending || !!incident.dispatchedTaskId}
            onClick={() => setVoiceOpen(true)}
          >
            {tDetail('createTaskFromIncident')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={isPending}
            onClick={() => patchStatus('resolved')}
          >
            {t('markResolved')}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            {t('closePanel')}
          </Button>
        </div>
      );
    }
    if (incident.status === 'resolved' || incident.status === 'closed') {
      return (
        <div className="flex w-full flex-col gap-2">
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
          <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            {t('closePanel')}
          </Button>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
      <ResponsiveModal open={open} onOpenChange={onOpenChange}>
        <ResponsiveModalContent
          title={stickyTitle}
          description={t('subtitle')}
          headerAdornment={headerAdornment}
          className="max-w-xl"
          bodyClassName="px-4 pt-4 pb-4"
          footer={
            incidentFooter ? (
              <div className="pb-safe">{incidentFooter}</div>
            ) : undefined
          }
        >
          <div className="detail-scroll-body flex flex-col gap-[var(--space-4,1rem)]">
            {incident.reporterName ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{t('reporter')}</span> {incident.reporterName}
              </p>
            ) : null}

            <div
              className={cn(
                'rounded-xl border p-3 text-sm',
                incident.type === 'damage' &&
                  'border-red-500/30 bg-red-50/80 text-red-950 dark:bg-red-950/15 dark:text-red-100',
                incident.type === 'lost_item' &&
                  'border-amber-500/30 bg-amber-50/80 text-amber-950 dark:bg-amber-950/20 dark:text-amber-50',
                incident.type === 'rule_violation' &&
                  'border-orange-500/30 bg-orange-50/85 text-orange-950 dark:bg-orange-950/25 dark:text-orange-50',
                incident.type === 'emergency' &&
                  'border-violet-500/35 bg-violet-50/90 text-violet-950 dark:bg-violet-950/30 dark:text-violet-50',
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
                <div className="space-y-2">
                  <Label htmlFor="incident-note">{t('managerNote')}</Label>
                  <Textarea
                    id="incident-note"
                    value={managerNote}
                    onChange={(e) => setManagerNote(e.target.value)}
                    onBlur={() => onManagerNoteBlur()}
                    rows={3}
                    placeholder={t('managerNotePlaceholder')}
                  />
                </div>
                {incident.type === 'damage' && (
                  <div className="space-y-2">
                    <Label htmlFor="incident-cost">{t('estimatedCost')}</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        ₽
                      </span>
                      <Input
                        id="incident-cost"
                        value={estimatedCost}
                        onChange={(e) => setEstimatedCost(e.target.value)}
                        onBlur={() => onCostBlur()}
                        placeholder={t('estimatedCostPlaceholder')}
                        className="pl-8"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <VoiceTaskCreateSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        propertyId={incident.propertyId}
        incidentPrefill={
          voiceOpen
            ? { notes: incident.description, incidentUuid: incident.uuid }
            : null
        }
      />
    </>
  );
}
