'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import { usePriceToday, usePricingAccess, usePricingMutations, usePricingProperties, usePromotions } from '../hooks';
import { guestPrice } from '../lib/pricing-ui';
import { CampaignStatusBadge, ChoiceChip, TargetStateBadge, useErrorLabel, usePriceFormatter, useStayRangeFormatter } from './shared';

const GENIUS_OPTIONS = [0, 10, 15, 20] as const;

/** «Скидки Booking.com» + «Защита цены» on the property page. Hidden unless «Цены» is on. */
export function PropertyPricingCard({ propertyId }: { propertyId: string }) {
  const t = useTranslations('pricing.property');
  const tp = useTranslations('pricing.promotions');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const errorLabel = useErrorLabel();
  const access = usePricingAccess();
  const { data: rows } = usePricingProperties(access.enabled);
  const row = rows?.find((r) => r.id === propertyId);
  const visible = access.enabled && !!row?.bookingConnected;

  const { data: promos, isLoading } = usePromotions(visible, propertyId);
  const price = usePriceToday(propertyId, visible);
  const { targetAction, saveSettings } = usePricingMutations();

  const [showPast, setShowPast] = useState(false);
  const [min, setMin] = useState('');
  const [genius, setGenius] = useState<number>(0);
  useEffect(() => {
    if (!row) return;
    setMin(row.minPrice != null ? String(row.minPrice) : '');
    setGenius(row.geniusPct ?? 0);
  }, [row]);

  if (!visible || !row) return null;

  const current = (promos ?? []).filter((p) => p.derivedStatus === 'active');
  const past = (promos ?? []).filter((p) => p.derivedStatus !== 'active');
  const visibleNow = current
    .filter((p) => p.target?.desiredState === 'on' && (p.target.state === 'on' || p.target.state === 'pending'))
    .sort((a, b) => b.discountPct - a.discountPct)[0];
  const today = price.data?.price ?? null;
  const currency = price.data?.currency;
  const minNum = min.trim() === '' ? null : Number(min.replace(',', '.'));
  const settingsDirty = (minNum ?? null) !== (row.minPrice ?? null) || genius !== (row.geniusPct ?? 0);

  const act = (promotionId: string, action: 'activate' | 'deactivate') =>
    targetAction.mutate(
      { id: promotionId, propertyId, action },
      { onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')) },
    );

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div>
            <h2 className="font-semibold">{t('title')}</h2>
            <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Button asChild size="sm" className="gap-1.5">
            <Link href={`/dashboard/pricing?new=${propertyId}`}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('add')}
            </Link>
          </Button>
        </div>
        {isLoading ? (
          <div className="p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : current.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul>
            {current.map((p) => {
              const off = p.target?.desiredState === 'off';
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-4 py-3 last:border-b-0">
                  <span className="w-12 shrink-0 text-base font-bold text-emerald-700 dark:text-emerald-400">−{p.discountPct}%</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pricing?promotion=${p.id}`} className="block truncate font-semibold hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {fmtRange(p.stayFrom, p.stayTo)} · {p.source === 'booking' ? tp('fromBooking') : tp('typeBasic')}
                    </p>
                    {today != null ? (
                      <p className="text-xs text-muted-foreground">
                        {fmtPrice(today)} → {fmtPrice(Math.round(guestPrice(today, p.discountPct) * 100) / 100, currency)} ·{' '}
                        {t('geniusShort', { price: fmtPrice(Math.round(guestPrice(today, p.discountPct, row.geniusPct) * 100) / 100, currency) })}
                      </p>
                    ) : null}
                    {p.target?.lastErrorCode && (p.target.state === 'error' || p.target.state === 'skipped') ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">{errorLabel(p.target.lastErrorCode)}</p>
                    ) : null}
                  </div>
                  {p.target ? <TargetStateBadge state={p.target.state} /> : null}
                  {p.source === 'rentai' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={targetAction.isPending}
                      className={cn(!off && 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300')}
                      onClick={() => act(p.id, off ? 'activate' : 'deactivate')}
                    >
                      {off ? t('turnOn') : t('turnOff')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {past.length > 0 ? (
          <div className="border-t border-border px-4 py-2.5">
            <button type="button" aria-expanded={showPast} className="min-h-10 text-sm font-semibold text-primary hover:underline" onClick={() => setShowPast(!showPast)}>
              {showPast ? t('hidePast') : t('past', { count: past.length })}
            </button>
            {showPast ? (
              <ul className="space-y-2 pb-2">
                {past.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                    <span>
                      <strong>−{p.discountPct}%</strong> · {p.name} · {fmtRange(p.stayFrom, p.stayTo)}
                    </span>
                    <CampaignStatusBadge status={p.derivedStatus} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <h2 className="font-semibold">{t('priceTitle')}</h2>
          {price.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : today == null ? (
            <p className="text-sm text-muted-foreground">{t('priceUnknown')}</p>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted-foreground">{t('today')}</p>
                <p className="text-xl font-semibold tabular-nums">{fmtPrice(today, currency)}</p>
              </div>
              <div className={cn('rounded-xl px-3.5 py-3', visibleNow ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-muted')}>
                <p className="text-xs text-muted-foreground">
                  {visibleNow ? t('withDiscount', { pct: visibleNow.discountPct, dates: fmtRange(visibleNow.stayFrom, visibleNow.stayTo) }) : t('noDiscount')}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {fmtPrice(Math.round(guestPrice(today, visibleNow?.discountPct ?? 0) * 100) / 100, currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('geniusShort', { price: fmtPrice(Math.round(guestPrice(today, visibleNow?.discountPct ?? 0, row.geniusPct) * 100) / 100, currency) })}
                </p>
              </div>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <div>
            <h2 className="font-semibold">{t('protectTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('protectSubtitle')}</p>
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            {t('minLabel')}
            <Input inputMode="decimal" value={min} placeholder={t('noMin')} onChange={(e) => setMin(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))} />
          </label>
          <div role="group" aria-label={t('geniusLabel')} className="space-y-1.5 text-xs font-medium text-muted-foreground">
            {t('geniusLabel')}
            <div className="grid grid-cols-4 gap-1.5">
              {GENIUS_OPTIONS.map((g) => (
                <ChoiceChip key={g} selected={genius === g} className="h-10 min-w-0 px-2" onClick={() => setGenius(g)}>
                  {g ? `${g}%` : t('geniusNone')}
                </ChoiceChip>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('geniusNote')}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href="/dashboard/pricing/min-prices" className="text-sm font-semibold text-primary hover:underline">
              {t('allObjects')}
            </Link>
            <Button
              size="sm"
              disabled={!settingsDirty || saveSettings.isPending || (minNum != null && !Number.isFinite(minNum))}
              onClick={() =>
                saveSettings.mutate([{ propertyId, minPrice: minNum, geniusPct: genius }], {
                  onSuccess: () => toast.success(t('saved')),
                  onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
                })
              }
            >
              {saveSettings.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
