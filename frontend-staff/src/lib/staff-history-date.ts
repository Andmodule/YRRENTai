import { format, isBefore, isToday, parseISO, startOfDay } from 'date-fns';
import type { Task } from '@/hooks/use-tasks';

/** Завершение сегодня (по `completedAt`, локальная дата) — не путать с `dueDate`. */
export function isTaskCompletedToday(t: Task): boolean {
  if (t.status !== 'done' || !t.completedAt) return false;
  try {
    return isToday(parseISO(t.completedAt));
  } catch {
    return false;
  }
}

/** «История»: завершённые задачи с датой завершения раньше сегодняшнего календарного дня (локально). */
export function isTaskDoneBeforeToday(t: Task): boolean {
  if (t.status !== 'done') return false;
  const todayStart = startOfDay(new Date());
  if (t.completedAt) {
    return isBefore(startOfDay(parseISO(t.completedAt)), todayStart);
  }
  if (t.dueDate) {
    return t.dueDate < format(todayStart, 'yyyy-MM-dd');
  }
  return false;
}

/** Инциденты в истории — только созданные до сегодняшнего дня. */
export function isIncidentCreatedBeforeToday(createdAtIso: string): boolean {
  return isBefore(startOfDay(parseISO(createdAtIso)), startOfDay(new Date()));
}
