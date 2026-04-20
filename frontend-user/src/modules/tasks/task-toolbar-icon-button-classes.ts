/**
 * Квадратные кнопки-иконки в тулбаре задач (поиск, период) — те же токены для «+» в AppShell header (объекты/персонал).
 */
export const tasksToolbarIconButtonBase =
  'h-8 w-8 rounded-lg border transition-colors' as const;

export const tasksToolbarIconButtonIdle =
  'border-border bg-card text-muted-foreground shadow-sm hover:bg-muted/70 dark:border-border dark:bg-card/60 dark:hover:bg-muted/40' as const;

export const tasksToolbarIconButtonActive =
  'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 dark:shadow-[0_0_14px_-3px_rgba(0,180,200,0.35)]' as const;
