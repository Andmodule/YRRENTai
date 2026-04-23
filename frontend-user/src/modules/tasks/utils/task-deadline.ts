import { isValid, parseISO } from 'date-fns';
import type { Task } from '../types';

/**
 * End of the task deadline in local time: `dueDate` + `dueTime`, or end of `dueDate` if no time.
 */
export function getTaskDueAt(task: Pick<Task, 'dueDate' | 'dueTime'>): Date | null {
  let day: Date;
  try {
    day = parseISO(task.dueDate);
  } catch {
    return null;
  }
  if (!isValid(day)) return null;

  const trimmed = task.dueTime?.trim();
  if (trimmed) {
    const parts = trimmed.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d;
    }
  }

  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Non-done task whose deadline is strictly before `now`. */
export function isTaskOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.status === 'done') return false;
  const due = getTaskDueAt(task);
  if (!due) return false;
  return now.getTime() > due.getTime();
}
