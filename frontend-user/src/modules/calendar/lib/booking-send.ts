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

function nextDay(ymd: string): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
