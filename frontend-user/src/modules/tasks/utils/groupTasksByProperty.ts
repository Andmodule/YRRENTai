import type { Task, TaskPriority, PendingSupplyInterpretationEvent } from '../types';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';

/** Sentinel id for tasks without a property (null / empty from API). */
export const GENERAL_TASK_PROPERTY_GROUP_KEY = '__rentai_general_tasks__' as const;

/** Board list: all incidents in one block, shown first (like general tasks). */
export const INCIDENTS_BOARD_GROUP_KEY = '__rentai_incidents_board__' as const;

/** Очередь снабжения / нехватки (staff → LLM → менеджер), одна свёртка под инцидентами. */
export const SHORTAGE_BOARD_GROUP_KEY = '__rentai_shortage_supply_board__' as const;

const PRIORITY_SORT: Record<TaskPriority, number> = {
  critical: 0,
  urgent: 1,
  normal: 2,
};

export interface TaskPropertyGroup {
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  tasks: Task[];
  incidents: Incident[];
  shortageEvents: PendingSupplyInterpretationEvent[];
}

function normalizePropertyKey(propertyId: string | null | undefined): string {
  if (propertyId == null || propertyId.trim() === '') return GENERAL_TASK_PROPERTY_GROUP_KEY;
  return propertyId.trim();
}

function taskPropertyGroupKey(task: Task): string {
  if (task.isGeneralTask) return GENERAL_TASK_PROPERTY_GROUP_KEY;
  return normalizePropertyKey(task.propertyId);
}

function compareTasks(a: Task, b: Task): number {
  const pa = PRIORITY_SORT[a.priority] ?? 99;
  const pb = PRIORITY_SORT[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;
  const da = new Date(a.dueDate).getTime();
  const db = new Date(b.dueDate).getTime();
  if (da !== db) return da - db;
  return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
}

function compareIncidents(a: Incident, b: Incident): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function compareShortage(a: PendingSupplyInterpretationEvent, b: PendingSupplyInterpretationEvent): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * Manager board list: incidents are **not** mixed into property groups — they appear in a single block first
 * ({@link INCIDENTS_BOARD_GROUP_KEY}). Затем {@link SHORTAGE_BOARD_GROUP_KEY} (только снабжение/логистика). Remaining groups
 * contain **tasks only**, sorted general first then by title.
 *
 * @param opts.alwaysShowShortageGroup — если `false`, свёртка нехватки только при ненулевой очереди (напр. TMA).
 */
export function groupTasksAndIncidentsForBoard(
  tasks: Task[],
  incidents: Incident[],
  shortageEvents: PendingSupplyInterpretationEvent[] = [],
  opts?: { alwaysShowShortageGroup?: boolean },
): TaskPropertyGroup[] {
  const alwaysShowShortageGroup = opts?.alwaysShowShortageGroup ?? true;
  const map = new Map<
    string,
    {
      propertyId: string;
      propertyTitle: string;
      propertyAddress: string;
      tasks: Task[];
      incidents: Incident[];
    }
  >();

  const touch = (
    key: string,
    patch: Partial<Pick<TaskPropertyGroup, 'propertyTitle' | 'propertyAddress'>>,
  ) => {
    let g = map.get(key);
    if (!g) {
      g = {
        propertyId: key,
        propertyTitle: patch.propertyTitle ?? '',
        propertyAddress: patch.propertyAddress ?? '',
        tasks: [],
        incidents: [],
      };
      map.set(key, g);
    } else {
      if (patch.propertyTitle && !g.propertyTitle) g.propertyTitle = patch.propertyTitle;
      if (patch.propertyAddress && !g.propertyAddress) g.propertyAddress = patch.propertyAddress;
    }
    return g;
  };

  for (const task of tasks) {
    const key = taskPropertyGroupKey(task);
    const g = touch(key, {
      propertyTitle: key === GENERAL_TASK_PROPERTY_GROUP_KEY ? '' : task.propertyTitle,
      propertyAddress:
        key === GENERAL_TASK_PROPERTY_GROUP_KEY
          ? ''
          : task.streetAddress?.trim() || task.propertyAddress?.trim() || '',
    });
    g.tasks.push(task);
  }

  const propertyGroups: TaskPropertyGroup[] = [...map.values()].map((g) => ({
    ...g,
    tasks: [...g.tasks].sort(compareTasks),
    incidents: [],
    shortageEvents: [],
  }));

  propertyGroups.sort((a, b) => {
    if (a.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY) return -1;
    if (b.propertyId === GENERAL_TASK_PROPERTY_GROUP_KEY) return 1;
    return a.propertyTitle.localeCompare(b.propertyTitle, undefined, { sensitivity: 'base' });
  });

  const sortedIncidents = [...incidents].sort(compareIncidents);
  const supplyEvents = shortageEvents.filter((e) => e.managerBucket === 'supply');
  const sortedSupply = [...supplyEvents].sort(compareShortage);

  const incidentsBlock: TaskPropertyGroup | null =
    sortedIncidents.length > 0
      ? {
          propertyId: INCIDENTS_BOARD_GROUP_KEY,
          propertyTitle: '',
          propertyAddress: '',
          tasks: [],
          incidents: sortedIncidents,
          shortageEvents: [],
        }
      : null;

  const shortageBlock: TaskPropertyGroup | null =
    alwaysShowShortageGroup || sortedSupply.length > 0
      ? {
          propertyId: SHORTAGE_BOARD_GROUP_KEY,
          propertyTitle: '',
          propertyAddress: '',
          tasks: [],
          incidents: [],
          shortageEvents: sortedSupply,
        }
      : null;

  const head: TaskPropertyGroup[] = [];
  if (incidentsBlock) head.push(incidentsBlock);
  if (shortageBlock) head.push(shortageBlock);

  return [...head, ...propertyGroups];
}
