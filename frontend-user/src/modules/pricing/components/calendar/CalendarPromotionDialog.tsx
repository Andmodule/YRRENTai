'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Link } from '@/i18n/navigation';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { CellPromotion } from '../../lib/pricing-ui';
import { isNotSent, isNotStandardRate, isTargetingType, nightPrices } from '../../lib/pricing-ui';
import { usePricingMutations } from '../../hooks';
import { useErrorLabel, usePriceFormatter, useStayRangeFormatter } from '../shared';

/** Discounts on one night of one property: which one the guest sees, switch-off per property. */
export function CalendarPromotionDialog({
  open,
  onOpenChange,
  propertyId,
  propertyTitle,
  ymd,
  promotions,
  rackPrice,
  currency,
  geniusPct,
  targetingPct,
  rateName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyTitle: string;
  ymd: string;
  promotions: CellPromotion[];
  rackPrice: number | null;
  currency?: string | null;
  geniusPct: number | null;
  /** Mobile / Country rate of the property (%), null when it has none. */
  targetingPct: number | null;
  /** Rate the night price was taken from (Booking rate name), when known. */
  rateName: string | null;
}) {
  const t = useTranslations('pricing.calendar');
  const fmtPrice = usePriceFormatter();
  const fmtRange = useStayRangeFormatter();
  const { targetAction } = usePricingMutations();
  const errorLabel = useErrorLabel();
  const first = promotions[0];
  /** What the guest sees: never a discount that did not reach Booking (those are sorted last). */
  const top = first && !isNotSent(first.state) ? first : undefined;
  /** The deal behind the regular price: a Mobile / Country rate applies to a part of the guests only. */
  const dealRow = promotions.find((p) => !isNotSent(p.state) && !isTargetingType(p.promotionType));
  const prices = rackPrice != null ? nightPrices(rackPrice, promotions, geniusPct, targetingPct) : null;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        title={dealRow ?? top ? t('dialogTitle', { pct: (dealRow ?? top)!.discountPct }) : first ? t('dialogNotSent') : t('dialogEmpty')}
        description={`${propertyTitle} · ${fmtRange(ymd, ymd)}`}
      >
        {first ? (
          <div className="space-y-4">
            {prices && rackPrice != null ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className={cn('rounded-xl px-3.5 py-3', prices.deal ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-muted')}>
                    <p className="text-xs text-muted-foreground">{t('regularGuest')}</p>
                    <p>
                      {prices.deal ? <s className="text-sm text-muted-foreground">{fmtPrice(rackPrice)}</s> : null}{' '}
                      <strong className={cn('text-lg', prices.deal && 'text-emerald-800 dark:text-emerald-300')}>
                        {fmtPrice(prices.regular, currency)}
                      </strong>
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted px-3.5 py-3">
                    <p className="text-xs text-muted-foreground">{geniusPct ? t('geniusGuestPct', { pct: geniusPct }) : t('geniusGuest')}</p>
                    <strong className="text-lg">{fmtPrice(prices.genius, currency)}</strong>
                  </div>
                </div>
                {prices.app != null && targetingPct ? (
                  <div className="rounded-xl bg-muted px-3.5 py-3">
                    <p className="text-xs text-muted-foreground">{t('appGuestPct', { pct: targetingPct })}</p>
                    <strong className="text-lg">{fmtPrice(prices.app, currency)}</strong>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {rateName ? `${t('rateLine', { name: rateName })} ` : ''}
                  {t('noTaxes')}
                </p>
                {isNotStandardRate(rateName) ? (
                  <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    {t('rateNotStandard', { name: rateName ?? '' })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <ul className="space-y-2">
              {promotions.map((p, i) => {
                const notSent = isNotSent(p.state);
                const onTop = isTargetingType(p.promotionType);
                const visible = !onTop && p.id === dealRow?.id;
                const visibleLabel =
                  p.state === 'on' ? (p.confirmed ? t('visible') : t('visibleUnconfirmed')) : p.state === 'pending' ? t('visibleSoon') : t('visibleDry');
                const canOff = p.source === 'rentai';
                return (
                  <li
                    key={p.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3',
                      notSent
                        ? 'border-dashed border-red-300 dark:border-red-500/40'
                        : visible
                          ? 'border-emerald-200 dark:border-emerald-500/30'
                          : 'border-border',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        «{p.name}» −{p.discountPct}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(p.source === 'booking' ? 'sourceBooking' : 'sourceRentai')}
                        {p.state === 'pending' ? ` · ${t('statePending')}` : p.state === 'dry_run' ? ` · ${t('stateDry')}` : ''}
                      </p>
                      {notSent ? (
                        <p className="mt-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                          {t('notSent')}
                          {p.errorCode ? ` ${errorLabel(p.errorCode)}` : ''}
                        </p>
                      ) : onTop ? (
                        <p className="mt-0.5 text-xs font-semibold text-sky-700 dark:text-sky-400">{t('appliesOnTop')}</p>
                      ) : (
                        <p
                          className={cn(
                            'mt-0.5 text-xs font-semibold',
                            visible && (p.state !== 'on' || p.confirmed) ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {visible ? visibleLabel : t('hidden')}
                        </p>
                      )}
                    </div>
                    {canOff ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={targetAction.isPending}
                        className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300"
                        onClick={() =>
                          targetAction.mutate(
                            { id: p.id, propertyId, action: 'deactivate' },
                            {
                              onSuccess: () => {
                                toast.success(t('offDone', { name: p.name }));
                                onOpenChange(false);
                              },
                              onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
                            },
                          )
                        }
                      >
                        {t('offHere')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Link href={`/dashboard/pricing?promotion=${first.id}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline">
              {t('open')}
            </Link>
          </div>
        ) : null}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
