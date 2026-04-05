'use client';

import { useCallback, useEffect, useState } from 'react';

/** Map of property group id → collapsed (includes the general-tasks sentinel id). */
const STORAGE_KEY = 'rentai.tasks.list.collapsedPropertyGroups.v1';

function readStored(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return {};
}

function writeStored(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Persisted open/closed state for property groups on the tasks list (manager).
 * `true` means the group is collapsed (content hidden).
 */
export function useTaskListCollapsedGroups() {
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsedById(readStored());
  }, []);

  const setCollapsed = useCallback((propertyGroupId: string, collapsed: boolean) => {
    setCollapsedById((prev) => {
      const next = { ...prev, [propertyGroupId]: collapsed };
      writeStored(next);
      return next;
    });
  }, []);

  return { collapsedById, setCollapsed };
}
