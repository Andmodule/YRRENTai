/** Shared Sonner styles for swipe undo toasts — matches light/dark theme tokens */
export const SWIPE_FEEDBACK_TOAST_CLASSNAMES = {
  toast:
    'group w-[min(100%,min(420px,calc(100vw-2rem)))] border border-border/70 bg-card text-card-foreground shadow-lg backdrop-blur-md dark:border-border dark:bg-card dark:text-card-foreground dark:shadow-black/30 rounded-xl',
  actionButton:
    'rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 dark:border-border dark:bg-muted/50 dark:hover:bg-muted',
} as const;
