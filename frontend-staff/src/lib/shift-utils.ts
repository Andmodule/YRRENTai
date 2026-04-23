import { addMinutes, format, parseISO, isToday, isBefore, isValid } from 'date-fns';
import type { Task } from '@/hooks/use-tasks';

const MINUTES_PER_TASK = 45;

export type DeadlineUrgency = 'teal' | 'amber' | 'amber_pulse' | 'red';

/** Parse dueDate (yyyy-MM-dd) + optional dueTime (HH:mm) as local Date; no time → end of that calendar day. */
export function dueDateTime(task: Task): Date | null {
  let day: Date;
  try {
    day = parseISO(task.dueDate);
  } catch {
    return null;
  }
  if (!isValid(day)) return null;

  const trimmed = task.dueTime?.trim();
  if (trimmed) {
    const [h, m] = trimmed.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d;
    }
  }

  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function deadlineUrgency(task: Task, now: Date = new Date()): DeadlineUrgency {
  const dt = dueDateTime(task);
  if (!dt) return 'teal';
  if (isBefore(dt, now)) return 'red';
  const diffMs = dt.getTime() - now.getTime();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours > 2) return 'teal';
  if (hours >= 1) return 'amber';
  return 'amber_pulse';
}

export function estimateShiftEnd(tasks: Task[]): { start: Date; end: Date } | null {
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'issue');
  if (active.length === 0) return null;
  const start = new Date();
  const end = addMinutes(start, active.length * MINUTES_PER_TASK);
  return { start, end };
}

export function formatElapsedMs(
  fromIso: string | null,
  options?: { includeSeconds?: boolean },
): string {
  if (!fromIso) return '';
  const start = parseISO(fromIso).getTime();
  if (!Number.isFinite(start)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const includeSeconds = options?.includeSeconds !== false;
  if (!includeSeconds) {
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}`;
    return `${m} мин`;
  }
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function isShiftDoneToday(iso: string | null): boolean {
  if (!iso) return false;
  return isToday(parseISO(iso));
}

/** Sort key for dueTime (HH:mm); nulls last. */
export function dueTimeSortKey(dueTime: string | null): string {
  return dueTime ?? '99:99';
}

/**
 * Pick the next task: pending or in_progress, earliest due date then due time.
 */
export function pickNextTaskByDueTime(tasks: Task[]): Task | null {
  const active = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  if (active.length === 0) return null;
  return [...active].sort((a, b) => {
    const byDate = a.dueDate.localeCompare(b.dueDate);
    if (byDate !== 0) return byDate;
    return dueTimeSortKey(a.dueTime).localeCompare(dueTimeSortKey(b.dueTime));
  })[0] ?? null;
}

/**
 * Shift duration: staffShiftCompletedAt − earliest inProgressStartedAt among tasks,
 * or session shift start (ms) if no in-progress timestamps.
 */
export function formatShiftDurationLabel(
  tasks: Task[],
  shiftCompletedAtIso: string | null,
  sessionShiftStartMs: number | null,
): string {
  if (!shiftCompletedAtIso) return '—';
  const end = parseISO(shiftCompletedAtIso).getTime();
  const fromTasks = tasks
    .map((t) => t.inProgressStartedAt)
    .filter((x): x is string => !!x)
    .map((s) => parseISO(s).getTime());
  const earliestProgress = fromTasks.length > 0 ? Math.min(...fromTasks) : null;
  const startMs = earliestProgress ?? sessionShiftStartMs;
  if (startMs == null || !Number.isFinite(end) || end <= startMs) return '—';
  const mins = Math.round((end - startMs) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}ч ${m}мин` : `${m}мин`;
}
