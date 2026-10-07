'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { useDateLocale } from '@/hooks/useDateLocale';
import { getApiErrorMessage } from '@/lib/api/error-message';
import type { PromotionDetail } from '../api';
import { usePricingMutations, usePromotion } from '../hooks';
import { isRuleStep, sumRevenue } from '../lib/pricing-ui';
import {
  CampaignStatusBadge,
  ConfirmDialog,
  TargetStateBadge,
  useErrorLabel,
  usePriceFormatter,
  useStayRangeFormatter,
} from './shared';

type Confirm = { kind: 'all' } | { kind: 'one'; propertyId: string; name: string } | null;

export function PromotionDetailSheet({
  promotionId,
  onOpenChange,
  onEdit,
  onRepeat,
}: {
  promotionId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (p: PromotionDetail) => void;
  onRepeat: (p: PromotionDetail) => void;
}) {
  const t = useTranslations('pricing.detail');
  const tp = useTranslations('pricing.promotions');
  const tw = useTranslations('pricing.form.weekdayShort');
  const dateLocale = useDateLocale();
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const errorLabel = useErrorLabel();
  const { data: p, isLoading } = usePromotion(promotionId);
  const { setActive, targetAction } = usePricingMutations();
  const [confirm, setConfirm] = useState<Confirm>(null);

  // A step of an auto rule is managed as a whole on the «Автоправила» tab; here only its objects and history.
  const ruleStep = !!p && isRuleStep(p);
  const editable = p?.source === 'rentai' && !ruleStep;
  const live = editable && p?.status === 'active' && p.derivedStatus !== 'finished';

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(getApiErrorMessage(e) ?? t('actionError'));
    }
  };

  const typeLabel = (type: string) =>
    type === 'last_minute' ? tp('typeLastMinute') : type === 'early_booker' ? tp('typeEarlyBooker') : tp('typeBasic');

  const footer = p ? (
    <div className="flex w-full flex-wrap justify-between gap-2">
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        {t('close')}
      </Button>
      <div className="flex flex-wrap gap-2">
        {live ? (
          <>
            <Button variant="outline" onClick={() => onEdit(p)}>
              {t('edit')}
            </Button>
            <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300" onClick={() => setConfirm({ kind: 'all' })}>
              {t('offAll')}
            </Button>
          </>
        ) : editable ? (
          <>
            {p.status === 'off' && p.derivedStatus !== 'finished' ? (
              <Button variant="outline" disabled={setActive.isPending} onClick={() => run(() => setActive.mutateAsync({ id: p.id, on: true }))}>
                {t('activate')}
              </Button>
            ) : null}
            <Button onClick={() => onRepeat(p)}>{t('repeat')}</Button>
          </>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <ResponsiveModal open={!!promotionId} onOpenChange={onOpenChange} desktopPresentation="side">
        <ResponsiveModalContent
          title={p?.name ?? '…'}
          className="sm:max-w-xl"
          headerAdornment={
            p ? (
              <div className="flex flex-wrap items-center gap-2">
                <CampaignStatusBadge status={p.derivedStatus} />
                <span className="text-xs text-muted-foreground">
                  {t(p.source === 'booking' ? 'sourceBooking' : 'sourceRentai')} · {typeLabel(p.promotionType)}
                </span>
              </div>
            ) : null
          }
          footer={footer}
        >
          {isLoading || !p ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-6 pb-2">
              {p.source === 'booking' ? (
                <p className="rounded-xl bg-indigo-50 px-3.5 py-3 text-sm text-indigo-950 dark:bg-indigo-500/10 dark:text-indigo-100">{t('bookingNote')}</p>
              ) : null}
              {ruleStep ? (
                <p className="rounded-xl bg-muted px-3.5 py-3 text-sm text-foreground">{t('ruleStepNote')}</p>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('discount')}</dt>
                  <dd className="mt-0.5 text-base font-bold text-emerald-700 dark:text-emerald-400">−{p.discountPct}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('dates')}</dt>
                  <dd className="mt-0.5 font-medium">{fmtRange(p.stayFrom, p.stayTo)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('weekdays')}</dt>
                  <dd className="mt-0.5 font-medium">{p.activeWeekdays?.length ? p.activeWeekdays.map((d) => tw(d)).join(', ') : tp('allDays')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('created')}</dt>
                  <dd className="mt-0.5 font-medium">{format(parseISO(p.createdAt), 'd MMMM yyyy', { locale: dateLocale })}</dd>
                </div>
              </dl>

              {p.stats ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-muted px-3.5 py-3">
                      <p className="text-xs text-muted-foreground">{t('stats.bookings')}</p>
                      <p className="text-lg font-semibold tabular-nums">{p.stats.bookings}</p>
                    </div>
                    <div className="rounded-xl bg-muted px-3.5 py-3">
                      <p className="text-xs text-muted-foreground">{t('stats.nights')}</p>
                      <p className="text-lg font-semibold tabular-nums">{p.stats.nights}</p>
                    </div>
                    <div className="rounded-xl bg-muted px-3.5 py-3">
                      <p className="text-xs text-muted-foreground">{t('stats.revenue')}</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {sumRevenue(p.stats.revenueByCurrency)
                          .map((r) => fmtPrice(r.amount, r.currency))
                          .join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('stats.source')}</p>
                </div>
              ) : (
                <p className="rounded-xl bg-muted px-3.5 py-3 text-sm text-muted-foreground">{t('stats.empty')}</p>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('objectsTitle', { on: p.counts.on, total: p.counts.total })}</h3>
                <ul className="overflow-hidden rounded-xl border border-border">
                  {p.targets.map((x) => (
                    <li key={x.propertyId} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-3.5 py-2.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{x.propertyName}</p>
                        {x.lastErrorCode && (x.state === 'error' || x.state === 'skipped') ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400">{errorLabel(x.lastErrorCode)}</p>
                        ) : x.verifyNote ? (
                          <p className="text-xs text-muted-foreground">{t('verifyNote')}</p>
                        ) : null}
                      </div>
                      <TargetStateBadge state={x.state} />
                      {live && x.desiredState === 'on' && (x.state === 'on' || x.state === 'pending' || x.state === 'dry_run') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300"
                          onClick={() => setConfirm({ kind: 'one', propertyId: x.propertyId, name: x.propertyName })}
                        >
                          {t('off')}
                        </Button>
                      ) : null}
                      {live && x.desiredState === 'off' ? (
                        <Button size="sm" variant="outline" disabled={targetAction.isPending} onClick={() => run(() => targetAction.mutateAsync({ id: p.id, propertyId: x.propertyId, action: 'activate' }))}>
                          {t('on')}
                        </Button>
                      ) : null}
                      {p.source === 'rentai' && x.state === 'error' ? (
                        <Button size="sm" variant="outline" disabled={targetAction.isPending} onClick={() => run(() => targetAction.mutateAsync({ id: p.id, propertyId: x.propertyId, action: 'retry' }))}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          {t('retry')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('history')}</h3>
                <ol className="overflow-hidden rounded-xl border border-border">
                  {p.events.map((e) => (
                    <li key={e.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-border/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
                      <span className="whitespace-nowrap text-muted-foreground">{format(parseISO(e.createdAt), 'd MMM, HH:mm', { locale: dateLocale })}</span>
                      <span>
                        <span className="block">{e.message}</span>
                        <span className="block text-muted-foreground">{e.actorLabel}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

      {p ? (
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm?.kind === 'one' ? t('confirmOffOneTitle') : t('confirmOffAllTitle')}
          text={
            confirm?.kind === 'one'
              ? t('confirmOffOneText', { object: confirm.name, name: p.name })
              : t('confirmOffAllText', { name: p.name })
          }
          confirmLabel={t('confirm')}
          pending={setActive.isPending || targetAction.isPending}
          onConfirm={() =>
            run(async () => {
              if (confirm?.kind === 'one') {
                await targetAction.mutateAsync({ id: p.id, propertyId: confirm.propertyId, action: 'deactivate' });
              } else {
                await setActive.mutateAsync({ id: p.id, on: false });
              }
              setConfirm(null);
              toast.success(t('offDone'));
            })
          }
        />
      ) : null}
    </>
  );
}
