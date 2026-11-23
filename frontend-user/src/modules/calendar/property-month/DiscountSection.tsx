'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { useBasePriceMutations } from '@/modules/pricing/hooks';
import type { BasePriceOverview, GuestPriceChannel, PriceDiscount } from '@/modules/pricing/api';
import { ChoiceChip } from '@/modules/pricing/components/shared';
import { ymdToDate } from '@/modules/pricing/lib/pricing-ui';

const CHANNELS: GuestPriceChannel[] = ['booking', 'airbnb'];
const CHANNEL_NAME: Record<GuestPriceChannel, string> = { booking: 'Booking', airbnb: 'Airbnb' };

function dayRange(from: string, to: string): string {
  const a = format(ymdToDate(from), 'dd.MM');
  return from === to ? a : `${a}–${format(ymdToDate(to), 'dd.MM')}`;
}

/**
 * «Скидка» for the picked nights: −N % on Booking and / or Airbnb, kept on top of the base price (the base
 * price itself does not change). «Убрать» brings the nights back to the current base price. Airbnb follows by
 * itself; Booking only through «Отправить» of the panel (`onChanged(true)` runs its check).
 */
export function DiscountSection({
  propertyId,
  from,
  to,
  data,
  airbnbMode,
  canCheck,
  disabled,
  onChanged,
}: {
  propertyId: string;
  /** Picked nights, inclusive. */
  from: string;
  to: string;
  data: BasePriceOverview;
  /** How Airbnb takes its price (see BasePricePanel). */
  airbnbMode: 'base' | 'booking' | 'off';
  /** «Отправить в Booking» can be checked now (pilot, not dry run, no run going). */
  canCheck: boolean;
  /** A Booking run is going. */
  disabled: boolean;
  /** After a save / removal; `checkBooking` — Booking prices changed, check what a send would do. */
  onChanged: (checkBooking: boolean) => void;
}) {
  const t = useTranslations('calendar.propertyMonth.basePrice.discount');
  const base = useBasePriceMutations(propertyId);
  const [pct, setPct] = useState('');
  // Airbnb from Booking: an Airbnb discount would not reach it (the Booking one does, through the Booking price).
  const [channels, setChannels] = useState<Set<GuestPriceChannel>>(() => new Set(airbnbMode === 'base' ? CHANNELS : ['booking']));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Discounts that cover at least one picked night, biggest first.
  const here = useMemo<PriceDiscount[]>(
    () => (data.discounts ?? []).filter((d) => d.from <= to && d.to >= from).sort((a, b) => b.pct - a.pct),
    [data.discounts, from, to],
  );

  const fail = (e: unknown) => toast.error(getApiErrorMessage(e) ?? t('pctError'));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(pct.trim().replace(',', '.'));
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setError(t('pctError'));
      return;
    }
    if (channels.size === 0) {
      setError(t('channelsError'));
      return;
    }
    setError(null);
    const chosen = CHANNELS.filter((c) => channels.has(c));
    base.createDiscount.mutate(
      { from, to, pct: n, channels: chosen, name: name.trim() || null },
      {
        onSuccess: (r) => {
          const check = chosen.includes('booking') && canCheck;
          toast.success(check ? t('savedChecking') : t('saved'));
          if (r.filledFromBooking > 0) toast.message(t('filled', { count: r.filledFromBooking }));
          if (r.noPrice.length > 0) toast.warning(t('noPrice', { count: r.noPrice.length }));
          if (r.atMin.length > 0) toast.warning(t('atMin', { count: r.atMin.length }));
          setPct('');
          setName('');
          onChanged(check);
        },
        onError: fail,
      },
    );
  };

  const remove = (d: PriceDiscount) =>
    base.deleteDiscount.mutate(d.id, {
      onSuccess: () => {
        const check = d.channels.includes('booking') && canCheck;
        toast.success(check ? t('removedChecking') : d.channels.includes('booking') ? t('removedRentai') : t('removed'));
        onChanged(check);
      },
      onError: fail,
    });

  const busy = base.createDiscount.isPending || base.deleteDiscount.isPending || disabled;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold">{t('title')}</h4>

      {here.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('active')}</p>
          <ul className="space-y-1">
            {here.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-950 dark:bg-sky-500/10 dark:text-sky-100">
                <span className="min-w-0 flex-1 truncate">
                  {t('item', {
                    pct: d.pct,
                    range: dayRange(d.from, d.to),
                    channels: d.channels.map((c) => CHANNEL_NAME[c]).join(', '),
                  })}
                  {d.name ? ` · ${d.name}` : ''}
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => remove(d)}>
                  {base.deleteDiscount.isPending && base.deleteDiscount.variables === d.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
          {here.length > 1 ? <p className="text-[11px] text-muted-foreground">{t('biggestWins')}</p> : null}
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-2" noValidate>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('pctLabel')}</span>
            <Input
              inputMode="numeric"
              value={pct}
              onChange={(e) => {
                setPct(e.target.value);
                setError(null);
              }}
              placeholder="10"
              aria-invalid={error === t('pctError')}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('nameLabel')}</span>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
          </label>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('channels')}</p>
          <div className="flex gap-1.5">
            {CHANNELS.map((c) => (
              <ChoiceChip
                key={c}
                compact
                selected={channels.has(c)}
                onClick={() => {
                  const next = new Set(channels);
                  if (next.has(c)) next.delete(c);
                  else next.add(c);
                  setChannels(next);
                  setError(null);
                }}
              >
                {CHANNEL_NAME[c]}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">{t('hint')}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{t(`airbnbNote_${airbnbMode}`)}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{t('autoNote')}</p>
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {base.createDiscount.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {channels.has('booking') && canCheck ? t('applyAndCheck') : t('apply')}
        </Button>
      </form>
    </div>
  );
}
