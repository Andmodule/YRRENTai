import { addMinutes, format, parseISO, isToday, isBefore } from 'date-fns';
import type { Task } from '@/hooks/use-tasks';

const MINUTES_PER_TASK = 45;

export type DeadlineUrgency = 'teal' | 'amber' | 'amber_pulse' | 'red';

/** Parse dueDate (yyyy-MM-dd) + dueTime (HH:mm) as local Date. */
export function dueDateTime(task: Task): Date | null {
  if (!task.dueTime) return null;
  const [h, m] = task.dueTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = parseISO(task.dueDate);
  d.setHours(h, m, 0, 0);
  return d;
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

export function formatElapsedMs(fromIso: string | null): string {
  if (!fromIso) return '';
  const start = parseISO(fromIso).getTime();
  const sec = Math.floor((Date.now() - start) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function isShiftDoneToday(iso: string | null): boolean {
  if (!iso) return false;
  return isToday(parseISO(iso));
}
