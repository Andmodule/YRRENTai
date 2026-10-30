'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProperties } from '@/hooks/use-properties';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { AirbnbListingsView, AirbnbPlanSummary } from '../api';
import { airbnbKeys, useAirbnbAccess, useAirbnbListing, useAirbnbMutations } from '../hooks';
import { canConnect, canSend, lastNight, operationDates, steps, usablePlan, ymdLong, type StepState } from '../lib/airbnb-ui';
import { useQueryClient } from '@tanstack/react-query';

function time(iso: string | null | undefined): string {
  return iso ? format(parseISO(iso), 'dd.MM HH:mm') : '';
}

/**
 * «Airbnb» (pilot): 1) the owner's Airbnb host, 2) the checked calendar of the pilot listing for a property,
 * 3) connecting the listing and sending that calendar. Every write needs the person's click and is limited by
 * the server to the pilot listing.
 */
export function AirbnbScreen() {
  const t = useTranslations('airbnb');
  const qc = useQueryClient();
  const { isOwner, enabled, status } = useAirbnbAccess();
  const { properties = [], isLoading: propsLoading } = useProperties({ enabled });
  // Only properties connected to Booking: the Airbnb calendar is built from Booking.
  const bookingProps = useMemo(
    () => properties.filter((p) => !!p.zodomusPropertyId || (p.channelListings ?? []).some((c) => c.otaPlatform?.code === 'booking')),
    [properties],
  );
  const [propertyId, setPropertyId] = useState<string | null>(null);
  useEffect(() => {
    if (!propertyId && bookingProps[0]) setPropertyId(bookingProps[0].id);
  }, [bookingProps, propertyId]);

  const listing = useAirbnbListing(enabled ? propertyId : null);
  const m = useAirbnbMutations(propertyId);
  const listings = qc.getQueryData<AirbnbListingsView>(airbnbKeys.listings) ?? m.listings.data ?? null;
  const [acknowledged, setAcknowledged] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fail = (e: unknown) => toast.error(getApiErrorMessage(e) ?? t('error'));

  if (!isOwner) return <Shell><p className="text-sm text-muted-foreground">{t('ownerOnly')}</p></Shell>;
  if (status.isLoading) return <Shell><Skeleton className="h-40 w-full" /></Shell>;
  if (!enabled) return <Shell><p className="text-sm text-muted-foreground">{t('off')}</p></Shell>;

  const host = status.data;
  const view = listing.data;
  const job = view?.job ?? null;
  const running = job?.state === 'running';
  const plan = usablePlan(job, now);
  const [s1, s2, s3] = steps(host, view, plan);

  return (
    <Shell>
      {/* 1. Host */}
      <Step n={1} state={s1} title={t('host.title')}>
        {host?.host?.active ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('host.active', { at: time(host.host.checkedAt) })}
          </p>
        ) : host?.host?.authUrl ? (
          <div className="space-y-2 text-sm">
            <p>{t('host.allowHint')}</p>
            <a
              href={host.host.authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-primary underline underline-offset-2"
            >
              {t('host.allowLink')}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            {host.host.statusText ? <p className="text-muted-foreground">{t('host.statusNow', { text: host.host.statusText })}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('host.none')}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!host?.host?.active ? (
            <Button size="sm" disabled={m.activateHost.isPending} onClick={() => m.activateHost.mutate(undefined, { onError: fail })}>
              {m.activateHost.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {host?.host ? t('host.activateAgain') : t('host.activate')}
            </Button>
          ) : null}
          {host?.host ? (
            <Button size="sm" variant="outline" disabled={m.refreshHost.isPending} onClick={() => m.refreshHost.mutate(undefined, { onError: fail })}>
              {m.refreshHost.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {t('host.refresh')}
            </Button>
          ) : null}
          {host?.host?.active ? (
            <Button size="sm" variant="outline" disabled={m.listings.isPending} onClick={() => m.listings.mutate(undefined, { onError: fail })}>
              {m.listings.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {t('host.findListing')}
            </Button>
          ) : null}
          {listings ? (
            <span className="text-xs text-muted-foreground">
              {listings.pilot
                ? t('host.found', { name: listings.pilot.name ?? listings.pilot.id, others: listings.others })
                : t('host.notFound', { others: listings.others })}
            </span>
          ) : null}
        </div>
      </Step>

      {/* 2. Calendar */}
      <Step n={2} state={s2} title={t('plan.title')}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="airbnb-property" className="text-xs text-muted-foreground">
            {t('plan.property')}
          </label>
          <div className="w-72 max-w-full">
            <Select
              id="airbnb-property"
              value={propertyId ?? ''}
              disabled={propsLoading || running}
              onChange={(e) => {
                setPropertyId(e.target.value || null);
                setAcknowledged(false);
              }}
            >
              {bookingProps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('plan.rule')}</p>
        {view?.takenByOther ? <Notice tone="warn">{t('plan.takenByOther')}</Notice> : null}

        {job?.kind === 'check' && running ? (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('plan.checking')}
          </p>
        ) : null}
        {plan ? <PlanView plan={plan} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={plan ? 'outline' : 'default'}
            disabled={!propertyId || running || s2 === 'locked' || m.check.isPending}
            onClick={() => m.check.mutate(undefined, { onError: fail })}
          >
            {plan ? t('plan.checkAgain') : t('plan.check')}
          </Button>
          {plan ? (
            <span className="text-xs text-muted-foreground">
              {t('plan.checkedAt', { at: time(job?.finishedAt), requests: plan.requests })}
            </span>
          ) : null}
        </div>
      </Step>

      {/* 3. Connect / send */}
      <Step n={3} state={s3} title={view?.connected ? t('connect.titleConnected') : t('connect.title')}>
        {!view?.connected ? (
          <>
            <Notice tone="warn">{t('connect.warning')}</Notice>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
              {t('connect.acknowledge')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!canConnect({ host, listing: view, plan, acknowledged }) || m.connect.isPending}
                onClick={() => plan && m.connect.mutate(plan.fingerprint, { onError: fail })}
              >
                {m.connect.isPending || (running && job?.kind === 'connect') ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {t('connect.button')}
              </Button>
              {!plan && s3 !== 'locked' ? <span className="text-xs text-muted-foreground">{t('connect.needCheck')}</span> : null}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">
              {t('connect.connectedAt', { at: time(view.activatedAt), until: view.planEnd ? ymdLong(lastNight(view.planEnd)) : '—' })}
            </p>
            {view.lastSync ? (
              <p className="text-sm text-muted-foreground">
                {t(view.lastSync.kind === 'availability' ? 'connect.lastAvailability' : 'connect.lastFull', {
                  at: time(view.lastSyncAt),
                  sent: view.lastSync.sentCalls ?? 0,
                  failed: view.lastSync.failedCalls ?? 0,
                })}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">{t('connect.auto')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!canSend({ listing: view, plan }) || m.send.isPending}
                onClick={() => plan && m.send.mutate(plan.fingerprint, { onError: fail })}
              >
                {m.send.isPending || (running && job?.kind === 'send') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t('connect.send')}
              </Button>
              {!plan ? <span className="text-xs text-muted-foreground">{t('connect.sendHint')}</span> : null}
            </div>
          </>
        )}

        {job && job.kind !== 'check' && job.state !== 'running' ? (
          job.state === 'done' ? (
            <Notice tone="ok">
              {t(job.kind === 'connect' ? 'connect.doneConnect' : 'connect.doneSend', {
                at: time(job.finishedAt),
                sent: job.result?.sentCalls ?? 0,
              })}
            </Notice>
          ) : (
            <Notice tone="error">
              {job.error ?? t('error')}
              {job.result?.closedAll ? ` ${t('connect.closedAll')}` : ''}
            </Notice>
          )
        ) : null}
        {job?.kind === 'check' && job.state === 'failed' ? <Notice tone="error">{job.error ?? t('error')}</Notice> : null}
      </Step>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('airbnb');
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Step({ n, state, title, children }: { n: number; state: StepState; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className={cn(
        'space-y-3 rounded-xl border bg-card p-4',
        state === 'current' ? 'border-primary/60' : 'border-border',
        state === 'locked' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            state === 'done' && 'bg-emerald-600 text-white',
            state === 'current' && 'bg-primary text-primary-foreground',
            state === 'locked' && 'bg-muted text-muted-foreground',
          )}
          aria-hidden
        >
          {state === 'done' ? <Check className="h-4 w-4" /> : state === 'locked' ? <Lock className="h-3.5 w-3.5" /> : n}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {state === 'locked' ? null : children}
    </section>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'warn' && 'border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
        tone === 'error' && 'border-rose-300/70 bg-rose-50 text-rose-950 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100',
        tone === 'ok' && 'border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100',
      )}
    >
      {tone !== 'ok' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

function PlanView({ plan }: { plan: AirbnbPlanSummary }) {
  const t = useTranslations('airbnb.plan');
  const cells = [
    { label: t('period'), value: `${ymdLong(plan.from)} – ${ymdLong(lastNight(plan.toExclusive))}` },
    { label: t('forSale'), value: t('nights', { count: plan.forSale }) },
    { label: t('closed'), value: t('closedValue', { occupied: plan.occupied, noPrice: plan.noPrice }) },
    {
      label: t('prices'),
      value: plan.minPrice != null && plan.maxPrice != null ? t('priceRange', { min: plan.minPrice, max: plan.maxPrice }) : '—',
    },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg bg-muted/60 px-3 py-2">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-sm font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">{t('colDates')}</th>
              <th className="px-3 py-1.5 text-left font-medium">{t('colState')}</th>
              <th className="px-3 py-1.5 text-right font-medium">{t('colPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.sample.map((op, i) => (
              <tr key={`${op.dates[0]}-${i}`} className="border-t border-border tabular-nums">
                <td className="px-3 py-1.5">{operationDates(op)}</td>
                <td className={cn('px-3 py-1.5', op.availability === 'available' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>
                  {op.availability === 'available' ? t('open') : t('shut')}
                </td>
                <td className="px-3 py-1.5 text-right">{op.dailyPrice != null ? `${op.dailyPrice} zł` : '—'}</td>
              </tr>
            ))}
            {plan.operations > plan.sample.length ? (
              <tr className="border-t border-border text-muted-foreground">
                <td className="px-3 py-1.5" colSpan={3}>
                  {t('more', { count: plan.operations - plan.sample.length })}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
