'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Send, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { getApiErrorMessage } from '@/lib/api/error-message';
import type { RuleView } from '../api';
import { usePricingAccess, useRules, useRulesMutations } from '../hooks';
import { localYmd, nightsCount } from '../lib/pricing-ui';
import { PromotionDetailSheet } from './PromotionDetailSheet';
import { RuleFormSheet } from './RuleFormSheet';
import {
  CampaignStatusBadge,
  ConfirmDialog,
  TargetStateBadge,
  useStayRangeFormatter,
  useStepWhen,
  worstState,
} from './shared';

/** A rule that ends within this many days gets a reminder to renew it. */
const RENEW_WARN_DAYS = 30;

export function RulesScreen() {
  const t = useTranslations('pricing.rules');
  const tw = useTranslations('pricing.form.weekdayShort');
  const tp = useTranslations('pricing.promotions');
  const fmtRange = useStayRangeFormatter();
  const stepWhen = useStepWhen();
  const access = usePricingAccess();
  const { data: rules, isLoading, isError, refetch } = useRules(true);
  const { setActive, setPropertyActive, resend } = useRulesMutations();

  const [form, setForm] = useState<{ rule: RuleView | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<RuleView | null>(null);

  const today = localYmd();
  const act = (promise: Promise<unknown>, okText: string) =>
    promise.then(
      () => {
        toast.success(okText);
        setConfirmOff(null);
      },
      (e: unknown) => toast.error(getApiErrorMessage(e) ?? t('actionError')),
    );

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        <Button onClick={() => setForm({ rule: null })} className="h-11 gap-2 rounded-xl px-4">
          <Plus className="h-4 w-4" aria-hidden />
          {t('new')}
        </Button>
      </div>

      {isError ? (
        <ErrorState message={t('loadError')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !rules || rules.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-8 w-8" />}
          title={t('empty')}
          description={t('emptyHint')}
          action={
            <Button onClick={() => setForm({ rule: null })}>
              <Plus className="mr-1 h-4 w-4" />
              {t('new')}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-4">
          {rules.map((r) => {
            const live = r.status === 'active';
            const stale = r.counts.dry_run + r.counts.error + r.counts.skipped;
            const daysLeft = r.stayTo ? nightsCount(today, r.stayTo) - 1 : null;
            const endingSoon = live && daysLeft !== null && daysLeft >= 0 && daysLeft <= RENEW_WARN_DAYS;
            return (
              <li key={r.groupId} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{r.name}</h2>
                      <CampaignStatusBadge status={r.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('meta', {
                        period: fmtRange(r.stayFrom, r.stayTo),
                        days: r.weekdays?.length ? r.weekdays.map((d) => tw(d)).join(', ') : tp('allDays'),
                      })}
                      {r.protectMinPrice ? ` · ${t('protected')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {live ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setForm({ rule: r })}>
                          {t('edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300"
                          onClick={() => setConfirmOff(r)}
                        >
                          {t('turnOff')}
                        </Button>
                      </>
                    ) : r.status === 'off' ? (
                      <>
                        <Button size="sm" variant="outline" disabled={setActive.isPending} onClick={() => act(setActive.mutateAsync({ groupId: r.groupId, on: true }), t('turnedOn'))}>
                          {t('turnOn')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setForm({ rule: r })}>
                          {t('repeat')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setForm({ rule: r })}>
                        {t('repeat')}
                      </Button>
                    )}
                  </div>
                </div>

                {endingSoon ? (
                  <p className="mx-4 mb-3 flex gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{t('endingSoon', { date: fmtRange(r.stayTo, r.stayTo) })}</span>
                  </p>
                ) : null}

                <ol className="border-t border-border/60">
                  {r.steps.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                      <span className="w-14 text-base font-bold text-emerald-700 dark:text-emerald-400">−{s.discountPct}%</span>
                      <span className="min-w-0 flex-1 text-sm">{stepWhen(s.unit, s.value, s.bookTime)}</span>
                      <TargetStateBadge state={worstState(s.counts)} />
                      <button
                        type="button"
                        className="min-h-9 text-sm font-semibold text-primary hover:underline"
                        onClick={() => setDetailId(s.id)}
                      >
                        {t('details')}
                      </button>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-3">
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1.5 text-sm">
                    {r.properties.map((p) => (
                      <li key={p.propertyId} className="flex items-center gap-2">
                        <span className="truncate font-medium">{p.propertyName}</span>
                        <TargetStateBadge state={p.state} />
                        {live ? (
                          <button
                            type="button"
                            disabled={setPropertyActive.isPending}
                            className="min-h-9 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                            onClick={() =>
                              act(
                                setPropertyActive.mutateAsync({ groupId: r.groupId, propertyId: p.propertyId, on: p.state === 'off' }),
                                t(p.state === 'off' ? 'propertyOn' : 'propertyOff', { name: p.propertyName }),
                              )
                            }
                          >
                            {t(p.state === 'off' ? 'turnOn' : 'turnOff')}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {live && stale > 0 && !access.dryRun ? (
                    <Button size="sm" disabled={resend.isPending} onClick={() => act(resend.mutateAsync(r.groupId), t('resent'))}>
                      {resend.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" aria-hidden />}
                      {t('resend', { count: stale })}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RuleFormSheet open={form !== null} onOpenChange={(o) => !o && setForm(null)} rule={form?.rule ?? null} />

      <PromotionDetailSheet
        promotionId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        onEdit={() => undefined}
        onRepeat={() => undefined}
      />

      <ConfirmDialog
        open={confirmOff !== null}
        onOpenChange={(o) => !o && setConfirmOff(null)}
        title={t('confirmOffTitle')}
        text={t('confirmOffText', { name: confirmOff?.name ?? '' })}
        confirmLabel={t('turnOff')}
        pending={setActive.isPending}
        onConfirm={() => confirmOff && act(setActive.mutateAsync({ groupId: confirmOff.groupId, on: false }), t('turnedOff'))}
      />
    </div>
  );
}
