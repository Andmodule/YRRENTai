'use client';

import type { Task } from '../../types';
import { SharedDetailDrawer } from './SharedDetailDrawer';

interface TaskDetailDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staff view: read-only manager fields */
  isStaffView?: boolean;
}

export function TaskDetailDrawer({ task, open, onOpenChange, isStaffView }: TaskDetailDrawerProps) {
  /** Remount per task so title/notes state is not one frame empty before useEffect (fixes blank «Задача»). */
  return (
    <SharedDetailDrawer
      key={task?.uuid ?? 'closed'}
      mode="task"
      task={task}
      open={open}
      onOpenChange={onOpenChange}
      isStaffView={isStaffView}
    />
  );
}
