'use client';

import type { Incident } from '../hooks/useIncidents';
import { SharedDetailDrawer } from '@/modules/tasks/components/shared/SharedDetailDrawer';

interface IncidentDetailDrawerProps {
  incident: Incident | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Manager dashboard (default true). Set false for read-only staff / TMA. */
  isManagerView?: boolean;
  onOpenRelatedTask?: (taskUuid: string) => void;
}

export function IncidentDetailDrawer({
  incident,
  open,
  onOpenChange,
  isManagerView = true,
  onOpenRelatedTask,
}: IncidentDetailDrawerProps) {
  return (
    <SharedDetailDrawer
      mode="incident"
      incident={incident}
      open={open}
      onOpenChange={onOpenChange}
      isManagerView={isManagerView}
      onOpenRelatedTask={onOpenRelatedTask}
    />
  );
}
