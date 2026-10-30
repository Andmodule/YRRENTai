import type { AirbnbCalendarOperation, AirbnbHostView, AirbnbJob, AirbnbListingView, AirbnbPlanSummary } from '../api';

/** "2026-11-10:2026-11-12" → "10.11 – 12.11"; one night → "10.11". */
export function operationDates(op: AirbnbCalendarOperation): string {
  const raw = op.dates[0] ?? '';
  const [a, b] = raw.split(':');
  const fmt = (ymd: string | undefined) => (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : '');
  const from = fmt(a);
  const to = fmt(b);
  if (!from) return raw;
  return !to || to === from ? from : `${from} – ${to}`;
}

/** Same with the year: "30.10.2026". */
export function ymdLong(ymd: string | null | undefined): string {
  return ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : '';
}

/** The day before an exclusive end — the last night of the plan. */
export function lastNight(toExclusive: string): string {
  const d = new Date(Date.parse(`${toExclusive}T12:00:00Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** The server keeps a check 15 minutes. */
export const CHECK_TTL_MS = 15 * 60_000;

/** The plan the person may connect / send now: the last finished job's plan while it is fresh. */
export function usablePlan(job: AirbnbJob | null | undefined, now: number): AirbnbPlanSummary | null {
  if (!job?.plan || job.state === 'running') return null;
  const at = Date.parse(job.finishedAt ?? job.startedAt);
  if (!Number.isFinite(at) || now - at > CHECK_TTL_MS) return null;
  // A failed connect / send that rebuilt the plan shows the new calendar: it may be used (that is the point).
  if (job.state === 'failed' && job.kind !== 'check' && job.result?.activated) return null;
  return job.plan;
}

export type StepState = 'done' | 'current' | 'locked';

/** Which of the three steps is done, current or still locked. */
export function steps(host: AirbnbHostView | undefined, listing: AirbnbListingView | undefined, plan: AirbnbPlanSummary | null): [StepState, StepState, StepState] {
  const hostOk = host?.host?.active === true;
  if (!hostOk) return ['current', 'locked', 'locked'];
  if (listing?.connected) return ['done', 'done', 'done'];
  return ['done', plan ? 'done' : 'current', plan ? 'current' : 'locked'];
}

/** «Подключить» is allowed: active host, fresh plan, not connected, pilot not on another property, nothing running, box ticked. */
export function canConnect(p: {
  host: AirbnbHostView | undefined;
  listing: AirbnbListingView | undefined;
  plan: AirbnbPlanSummary | null;
  acknowledged: boolean;
}): boolean {
  return (
    p.host?.host?.active === true &&
    !!p.plan &&
    !!p.listing &&
    !p.listing.connected &&
    !p.listing.takenByOther &&
    p.listing.job?.state !== 'running' &&
    p.acknowledged
  );
}

/** «Отправить в Airbnb» is allowed: connected, fresh plan, nothing running. */
export function canSend(p: { listing: AirbnbListingView | undefined; plan: AirbnbPlanSummary | null }): boolean {
  return !!p.plan && !!p.listing?.connected && p.listing.job?.state !== 'running';
}
