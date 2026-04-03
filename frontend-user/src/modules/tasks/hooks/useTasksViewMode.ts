'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';

const STORAGE_KEY = 'rentai.tasks.view';

export const TASKS_VIEW_MODES = ['list', 'kanban', 'table'] as const;
export type TasksViewMode = (typeof TASKS_VIEW_MODES)[number];

function isTasksViewMode(v: string | null): v is TasksViewMode {
  return v === 'list' || v === 'kanban' || v === 'table';
}

export function useTasksViewMode() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const param = searchParams.get('view');
  const paramValid = isTasksViewMode(param) ? param : null;

  const [stored, setStored] = useState<TasksViewMode | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (isTasksViewMode(raw)) setStored(raw);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!paramValid) return;
    try {
      localStorage.setItem(STORAGE_KEY, paramValid);
    } catch {
      /* ignore */
    }
  }, [paramValid]);

  const view = useMemo<TasksViewMode>(() => paramValid ?? stored ?? 'list', [paramValid, stored]);

  const setView = useCallback(
    (next: TasksViewMode) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      setStored(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', next);
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    },
    [pathname, router, searchParams],
  );

  return { view, setView };
}
