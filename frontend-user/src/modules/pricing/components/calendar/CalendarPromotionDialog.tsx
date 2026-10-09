'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Link } from '@/i18n/navigation';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { CellPromotion } from '../../lib/pricing-ui';
import { guestPrice, isNotSent } from '../../lib/pricing-ui';
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
}) {
  const t = useTranslations('pricing.calendar');
  const fmtPrice = usePriceFormatter();
  const fmtRange = useStayRangeFormatter();
  const { targetAction } = usePricingMutations();
  const errorLabel = useErrorLabel();
  const first = promotions[0];
  /** What the guest sees: never a discount that did not reach Booking (those are sorted last). */
  const top = first && !isNotSent(first.state) ? first : undefined;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        title={top ? t('dialogTitle', { pct: top.discountPct }) : first ? t('dialogNotSent') : t('dialogEmpty')}
        description={`${propertyTitle} · ${fmtRange(ymd, ymd)}`}
      >
        {first ? (
          <div className="space-y-4">
            {top && rackPrice != null ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-50 px-3.5 py-3 dark:bg-emerald-500/10">
                  <p className="text-xs text-muted-foreground">{t('regularGuest')}</p>
                  <p>
                    <s className="text-sm text-muted-foreground">{fmtPrice(rackPrice)}</s>{' '}
                    <strong className="text-lg text-emerald-800 dark:text-emerald-300">
                      {fmtPrice(Math.round(guestPrice(rackPrice, top.discountPct) * 100) / 100, currency)}
                    </strong>
                  </p>
                </div>
                <div className="rounded-xl bg-muted px-3.5 py-3">
                  <p className="text-xs text-muted-foreground">{geniusPct ? t('geniusGuestPct', { pct: geniusPct }) : t('geniusGuest')}</p>
                  <strong className="text-lg">{fmtPrice(Math.round(guestPrice(rackPrice, top.discountPct, geniusPct) * 100) / 100, currency)}</strong>
                </div>
              </div>
            ) : null}
            <ul className="space-y-2">
              {promotions.map((p, i) => {
                const notSent = isNotSent(p.state);
                const visible = i === 0 && !notSent;
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
