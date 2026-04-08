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

/** Left accent strip + pill + dot for manager-facing status. */
export function incidentStatusUi(status: Incident['status']): {
  strip: string;
  dot: string;
  pill: string;
} {
  switch (status) {
    case 'awaiting_dispatch':
      return {
        strip: 'border-l-[4px] border-l-slate-400',
        dot: 'bg-slate-400',
        pill:
          'bg-slate-100 text-slate-800 dark:bg-slate-800/90 dark:text-slate-200 ring-1 ring-slate-400/25',
      };
    case 'assigned':
      return {
        strip: 'border-l-[4px] border-l-sky-500',
        dot: 'bg-sky-500',
        pill:
          'bg-sky-100 text-sky-950 dark:bg-sky-950/70 dark:text-sky-100 ring-1 ring-sky-500/25',
      };
    case 'open':
      return {
        strip: 'border-l-[4px] border-l-orange-500',
        dot: 'bg-orange-500',
        pill:
          'bg-orange-100 text-orange-900 dark:bg-orange-950/80 dark:text-orange-200 ring-1 ring-orange-500/25',
      };
    case 'in_review':
      return {
        strip: 'border-l-[4px] border-l-emerald-500',
        dot: 'bg-emerald-500',
        pill:
          'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/75 dark:text-emerald-100 ring-1 ring-emerald-500/25',
      };
    case 'resolved':
      return {
        strip: 'border-l-[4px] border-l-slate-400',
        dot: 'bg-slate-400',
        pill: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
      };
    case 'closed':
      return {
        strip: 'border-l-[4px] border-l-slate-500',
        dot: 'bg-slate-500',
        pill: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
      };
  }
}

/** Dot next to title in list row: open = orange, in_review = green, else red. */
export function incidentListStatusDotClass(status: Incident['status']): string {
  switch (status) {
    case 'awaiting_dispatch':
      return 'bg-slate-400';
    case 'assigned':
      return 'bg-sky-500';
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
