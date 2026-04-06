/**
 * Квадратные кнопки-иконки в тулбаре задач (поиск, период) — те же токены для «+» в AppShell header (объекты/персонал).
 */
export const tasksToolbarIconButtonBase =
  'h-8 w-8 rounded-lg border transition-colors' as const;

export const tasksToolbarIconButtonIdle =
  'border-slate-200/90 bg-white text-muted-foreground shadow-sm hover:bg-slate-50 dark:border-slate-600/55 dark:bg-slate-900/55 dark:hover:bg-slate-800/80' as const;

export const tasksToolbarIconButtonActive =
  'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 dark:shadow-[0_0_14px_-3px_rgba(0,180,200,0.35)]' as const;
