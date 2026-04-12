'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'rentai.tasks.supplyMatrix.collapsedSections.v1';

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
    /* ignore */
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
 * Collapsible sections on the supply matrix (pool / on-route subgroups / mixed).
 * `true` = collapsed (content hidden).
 */
export function useSupplyMatrixCollapsedSections() {
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsedById(readStored());
  }, []);

  const setCollapsed = useCallback((sectionId: string, collapsed: boolean) => {
    setCollapsedById((prev) => {
      const next = { ...prev, [sectionId]: collapsed };
      writeStored(next);
      return next;
    });
  }, []);

  return { collapsedById, setCollapsed };
}
