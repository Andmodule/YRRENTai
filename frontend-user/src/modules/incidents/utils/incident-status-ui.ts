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

/** Tiny dot inside status pill (kanban card): inherits pill text color — no second hue scale. */
const STATUS_PILL_DOT = 'bg-current opacity-80';

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
        dot: STATUS_PILL_DOT,
        pill:
          'bg-muted text-foreground ring-1 ring-border dark:bg-muted/80 dark:text-foreground',
      };
    case 'assigned':
      return {
        strip: 'border-l-[4px] border-l-primary',
        dot: STATUS_PILL_DOT,
        pill:
          'bg-primary/12 text-primary ring-1 ring-primary/25 dark:bg-primary/18 dark:text-primary',
      };
    case 'open':
      return {
        strip: 'border-l-[4px] border-l-orange-500',
        dot: STATUS_PILL_DOT,
        pill:
          'bg-orange-100 text-orange-950 ring-1 ring-orange-500/25 dark:bg-orange-950/80 dark:text-orange-200',
      };
    case 'in_review':
      return {
        strip: 'border-l-[4px] border-l-emerald-500',
        dot: STATUS_PILL_DOT,
        pill:
          'bg-emerald-100 text-emerald-950 ring-1 ring-emerald-500/25 dark:bg-emerald-950/75 dark:text-emerald-100',
      };
    case 'resolved':
      return {
        strip: 'border-l-[4px] border-l-muted-foreground/35',
        dot: STATUS_PILL_DOT,
        pill: 'bg-muted text-muted-foreground ring-1 ring-border dark:bg-muted/60',
      };
    case 'closed':
      return {
        strip: 'border-l-[4px] border-l-muted-foreground/25',
        dot: STATUS_PILL_DOT,
        pill: 'bg-muted/90 text-muted-foreground ring-1 ring-border dark:bg-muted/50',
      };
  }
}

/**
 * List row leading dot — only **action cues** (pill = full status). No gray “noise” dots.
 *
 * - **Red**: `awaiting_dispatch` — не назначено.
 * - **Green**: `in_review` — принять / проверить.
 * - **Else**: `null` — слот под точку скрыт (`opacity-0`), выравнивание как у задач.
 */
export function incidentListStatusDotClass(status: Incident['status']): string | null {
  switch (status) {
    case 'awaiting_dispatch':
      return 'bg-rose-500 dark:bg-rose-400';
    case 'in_review':
      return 'bg-emerald-500 dark:bg-emerald-400';
    default:
      return null;
  }
}
