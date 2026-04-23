'use client';

import type { Task } from '../../types';
import { SharedDetailDrawer } from './SharedDetailDrawer';

interface TaskDetailDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staff view: read-only manager fields */
  isStaffView?: boolean;
  /** Manager: scroll to «Заметки от персонала» when opening (e.g. from staff messages tab). */
  focusStaffNotes?: boolean;
}

export function TaskDetailDrawer({
  task,
  open,
  onOpenChange,
  isStaffView,
  focusStaffNotes,
}: TaskDetailDrawerProps) {
  /** Remount per task so title/notes state is not one frame empty before useEffect (fixes blank «Задача»). */
  return (
    <SharedDetailDrawer
      key={task?.uuid ?? 'closed'}
      mode="task"
      task={task}
      open={open}
      onOpenChange={onOpenChange}
      isStaffView={isStaffView}
      focusStaffNotes={focusStaffNotes}
    />
  );
}
