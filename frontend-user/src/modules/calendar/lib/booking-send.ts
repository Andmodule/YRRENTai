import type { CalendarDatesJob, DatesRange } from '../calendar-dates-api';

/**
 * Prices Booking has after a finished «Отправить в Booking»: every night of the sent ranges, except nights
 * Booking refused (failed ranges) and nights the check after sending found different. Empty while the run
 * is not finished, and for a run that stopped or failed — the ranges after the stop are listed nowhere, so
 * the calendar waits for its re-read of Booking.
 */
export function sentNightPrices(
  job: Pick<CalendarDatesJob, 'state' | 'failed' | 'verify'>,
  ranges: readonly Pick<DatesRange, 'dateFrom' | 'dateToExclusive' | 'price' | 'closed'>[],
): Record<string, number> {
  if (job.state !== 'done') return {};
  const mismatched = new Set(job.verify?.mismatched ?? []);
  const failed = (ymd: string) => job.failed.some((f) => ymd >= f.dateFrom && ymd < f.dateToExclusive);
  const out: Record<string, number> = {};
  for (const r of ranges) {
    if (r.closed) continue;
    for (let d = r.dateFrom; d < r.dateToExclusive; d = nextDay(d)) {
      if (!mismatched.has(d) && !failed(d)) out[d] = r.price;
    }
  }
  return out;
}

type StatusJob = Pick<
  CalendarDatesJob,
  'state' | 'failed' | 'verify' | 'total' | 'sent' | 'startedAt' | 'finishedAt' | 'dateFrom' | 'dateToExclusive'
>;

/** What the last Booking run of a property came to, in one line for the month page. */
export type SendStatus =
  | { kind: 'running'; done: number; total: number }
  /** Sent and the check after sending found Booking the same. */
  | { kind: 'ok'; at: string }
  /** Nothing was different on Booking: no requests went out. */
  | { kind: 'nothing'; at: string }
  /** Sent, but the check after sending could not read Booking. */
  | { kind: 'unchecked'; at: string }
  /** Finished, but some nights were refused or show another price on Booking. */
  | { kind: 'partial'; at: string; failedNights: number; mismatched: number }
  /** Broke off: the nights after the break are listed nowhere. */
  | { kind: 'failed' | 'stopped'; at: string };

export function sendStatus(job: StatusJob | null): SendStatus | null {
  if (!job) return null;
  if (job.state === 'running') return { kind: 'running', done: job.sent + job.failed.length, total: job.total };
  const at = job.finishedAt ?? job.startedAt;
  if (job.state === 'failed' || job.state === 'stopped') return { kind: job.state, at };
  const failedNights = job.failed.reduce((n, f) => n + nightsBetween(f.dateFrom, f.dateToExclusive), 0);
  const mismatched = job.verify?.mismatched.length ?? 0;
  if (failedNights > 0 || mismatched > 0) return { kind: 'partial', at, failedNights, mismatched };
  if (job.total === 0) return { kind: 'nothing', at };
  if (!job.verify || job.verify.error) return { kind: 'unchecked', at };
  return { kind: 'ok', at };
}

/**
 * Nights to pick again after a run that did not fully reach Booking (yyyy-MM-dd, both inclusive): from the
 * first refused or different night to the last one; a run that broke off — its whole range. Null when there
 * is nothing to send again.
 */
export function resendRange(job: StatusJob | null): { from: string; to: string } | null {
  const s = sendStatus(job);
  if (!job || !s) return null;
  if (s.kind === 'failed' || s.kind === 'stopped') return { from: job.dateFrom, to: prevDay(job.dateToExclusive) };
  if (s.kind !== 'partial') return null;
  const nights = [
    ...job.failed.flatMap((f) => [f.dateFrom, prevDay(f.dateToExclusive)]),
    ...(job.verify?.mismatched ?? []),
  ].sort();
  return { from: nights[0]!, to: nights[nights.length - 1]! };
}

function nightsBetween(from: string, toExclusive: string): number {
  return Math.max(0, Math.round((Date.parse(`${toExclusive}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000));
}

function prevDay(ymd: string): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function nextDay(ymd: string): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
