import type { BookingStatus } from '../types';

/** Light + dark (strategy / semantic tokens) for badges and ProgramBlock borders */
export const calendarStatusClasses: Record<BookingStatus, string> = {
  confirmed:
    'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-950/55 dark:text-blue-100 dark:border-blue-800/70',
  pending:
    'bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/45 dark:text-amber-100 dark:border-amber-800/60',
  cleaning:
    'bg-rose-100 text-rose-900 border border-rose-200 dark:bg-rose-950/45 dark:text-rose-100 dark:border-rose-800/60',
  blocked:
    'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-muted dark:text-muted-foreground dark:border-border',
};
