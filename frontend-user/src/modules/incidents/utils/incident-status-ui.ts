import type { Incident } from '../hooks/useIncidents';

/** Label keys under `tasks.kanban.incidentCard`. */
export type IncidentCardStatusKey =
  | 'statusAwaitingDispatch'
  | 'statusAssigned'
  | 'statusOpen'
  | 'statusPendingVerify'
  | 'statusResolved'
  | 'statusClosed';

export function incidentStatusLabelKey(status: Incident['status']): IncidentCardStatusKey {
  switch (status) {
    case 'awaiting_dispatch':
      return 'statusAwaitingDispatch';
    case 'assigned':
      return 'statusAssigned';
    case 'open':
      return 'statusOpen';
    case 'in_review':
      return 'statusPendingVerify';
    case 'resolved':
      return 'statusResolved';
    case 'closed':
      return 'statusClosed';
  }
}

/**
 * Left accent strip + pill + dot for manager-facing status.
 * Avoid `text-slate-800` / `text-slate-900` etc. on light theme: globals remap slate-700–950
 * to pale surfaces, which makes labels unreadable on white cards.
 */
export function incidentStatusUi(status: Incident['status']): {
  strip: string;
  dot: string;
  pill: string;
} {
  switch (status) {
    case 'awaiting_dispatch':
      return {
        strip: 'border-l-[4px] border-l-muted-foreground/45',
        dot: 'bg-muted-foreground/50',
        pill:
          'bg-muted text-foreground ring-1 ring-border dark:bg-muted/80 dark:text-foreground',
      };
    case 'assigned':
      return {
        strip: 'border-l-[4px] border-l-primary',
        dot: 'bg-primary',
        pill:
          'bg-primary/12 text-primary ring-1 ring-primary/25 dark:bg-primary/18 dark:text-primary',
      };
    case 'open':
      return {
        strip: 'border-l-[4px] border-l-orange-500',
        dot: 'bg-orange-500',
        pill:
          'bg-orange-100 text-orange-950 ring-1 ring-orange-500/25 dark:bg-orange-950/80 dark:text-orange-200',
      };
    case 'in_review':
      return {
        strip: 'border-l-[4px] border-l-emerald-500',
        dot: 'bg-emerald-500',
        pill:
          'bg-emerald-100 text-emerald-950 ring-1 ring-emerald-500/25 dark:bg-emerald-950/75 dark:text-emerald-100',
      };
    case 'resolved':
      return {
        strip: 'border-l-[4px] border-l-muted-foreground/35',
        dot: 'bg-muted-foreground/40',
        pill: 'bg-muted text-muted-foreground ring-1 ring-border dark:bg-muted/60',
      };
    case 'closed':
      return {
        strip: 'border-l-[4px] border-l-muted-foreground/25',
        dot: 'bg-muted-foreground/30',
        pill: 'bg-muted/90 text-muted-foreground ring-1 ring-border dark:bg-muted/50',
      };
  }
}

/** Dot next to title in list row: open = orange, in_review = green, else red. */
export function incidentListStatusDotClass(status: Incident['status']): string {
  switch (status) {
    case 'awaiting_dispatch':
      return 'bg-muted-foreground/50';
    case 'assigned':
      return 'bg-primary';
    case 'open':
      return 'bg-orange-500';
    case 'in_review':
      return 'bg-emerald-500';
    case 'resolved':
    case 'closed':
    default:
      return 'bg-red-500';
  }
}
