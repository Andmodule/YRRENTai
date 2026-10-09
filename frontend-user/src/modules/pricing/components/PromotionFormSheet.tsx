'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CalendarDays, Check, Clock, Loader2, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import {
  pricingApi,
  type BookingWeekday,
  type PromotionDetail,
  type PromotionInput,
} from '../api';
import { pricingKeys, usePricingMutations, usePricingProperties, usePromotion } from '../hooks';
import {
  DISCOUNT_PRESETS,
  WEEKDAYS,
  guestPrice,
  isBelowMin,
  localYmd,
  nightsCount,
  normalizeWeekdays,
  presetRange,
  type DatePreset,
} from '../lib/pricing-ui';
import {
  ChoiceChip,
  SectionTitle,
  TargetStateBadge,
  useErrorLabel,
  usePriceFormatter,
  useStayRangeFormatter,
} from './shared';

export type PromotionFormInitial = Partial<PromotionInput> & { preset?: DatePreset };

export interface PromotionFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit an existing discount (otherwise create). */
  promotion?: PromotionDetail | null;
  /** Prefill for a new discount (repeat, calendar selection). */
  initial?: PromotionFormInitial | null;
  /** After «Готово» in the report. */
  onDone?: (promotionId: string) => void;
}

type Step = 'form' | 'progress' | 'report';
const PREVIEW_ROWS = 8;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function PromotionFormSheet({ open, onOpenChange, promotion, initial, onDone }: PromotionFormSheetProps) {
  const t = useTranslations('pricing.form');
  const tw = useTranslations('pricing.form.weekdayShort');
  const fmtRange = useStayRangeFormatter();
  const fmtPrice = usePriceFormatter();
  const errorLabel = useErrorLabel();
  const isEdit = !!promotion;
  const today = localYmd();

  const { data: rows } = usePricingProperties(open);
  const { create, update, targetAction } = usePricingMutations();

  const [step, setStep] = useState<Step>('form');
  const [resultId, setResultId] = useState<string | null>(null);
  const [disc, setDisc] = useState<number>(10);
  const [custom, setCustom] = useState('');
  const [preset, setPreset] = useState<DatePreset>('week');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState<Set<BookingWeekday>>(new Set(WEEKDAYS));
  const [scope, setScope] = useState<'all' | 'pick'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [protect, setProtect] = useState(true);
  const [name, setName] = useState('');

  // Reset every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep('form');
    setResultId(null);
    setQ('');
    const src = promotion ?? null;
    const pct = src?.discountPct ?? initial?.discountPct ?? 10;
    const isPreset = (DISCOUNT_PRESETS as readonly number[]).includes(pct);
    setDisc(isPreset ? pct : 10);
    setCustom(isPreset ? '' : String(pct));
    const stayFrom = src?.stayFrom ?? initial?.stayFrom ?? null;
    const stayTo = src?.stayTo ?? initial?.stayTo ?? null;
    if (stayFrom && stayTo) {
      setPreset('custom');
      setFrom(stayFrom < today ? today : stayFrom);
      setTo(stayTo);
    } else {
      setPreset(initial?.preset ?? 'week');
      setFrom(today);
      setTo(today);
    }
    const wd = src ? src.activeWeekdays : initial?.weekdays;
    setDays(new Set(wd && wd.length ? wd : WEEKDAYS));
    if (src) {
      setScope('pick');
      setPicked(new Set(src.targets.filter((x) => x.desiredState === 'on').map((x) => x.propertyId)));
    } else if (initial?.propertyIds?.length) {
      setScope('pick');
      setPicked(new Set(initial.propertyIds));
    } else {
      setScope('all');
      setPicked(new Set());
    }
    setProtect(src?.protectMinPrice ?? initial?.protectMinPrice ?? true);
    setName(src?.name ?? initial?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const customPct = Number.parseInt(custom, 10);
  const discount = Number.isFinite(customPct) && customPct > 0 ? Math.min(customPct, 99) : disc;
  const range = preset === 'custom' ? { from, to } : presetRange(preset, today);
  const datesValid = range.from <= range.to && range.to >= today;
  const nights = datesValid ? nightsCount(range.from, range.to) : 0;
  const weekdays = normalizeWeekdays([...days]);

  const bookingRows = useMemo(() => (rows ?? []).filter((r) => r.bookingConnected), [rows]);
  const eligibleRows = useMemo(
    () => bookingRows.filter((r) => r.promotionsAccess !== 'denied' && r.inPilot !== false),
    [bookingRows],
  );
  const excludedRows = useMemo(
    () => (rows ?? []).filter((r) => !r.bookingConnected || r.promotionsAccess === 'denied' || r.inPilot === false),
    [rows],
  );
  const excludeReason = (r: (typeof excludedRows)[number]) =>
    t(!r.bookingConnected ? 'reasonNoBooking' : r.promotionsAccess === 'denied' ? 'reasonNoAccess' : 'reasonNotInPilot');
  /** Picked (e.g. from the calendar) but outside the pilot list — nothing would be sent for them. */
  const pickedOutOfPilot = useMemo(
    () => (rows ?? []).filter((r) => picked.has(r.id) && r.bookingConnected && r.inPilot === false),
    [rows, picked],
  );
  const selected = useMemo(
    () => (scope === 'all' ? eligibleRows : eligibleRows.filter((r) => picked.has(r.id))),
    [scope, eligibleRows, picked],
  );
  const selectedIds = useMemo(() => selected.map((r) => r.id), [selected]);
  const offByHand = useMemo(
    () => (promotion?.targets ?? []).filter((x) => x.desiredState === 'off' && !picked.has(x.propertyId)),
    [promotion, picked],
  );

  const input: PromotionInput = {
    discountPct: discount,
    stayFrom: range.from,
    stayTo: range.to,
    weekdays,
    propertyIds: scope === 'pick' || isEdit ? selectedIds : undefined,
    protectMinPrice: protect,
    ...(name.trim() ? { name: name.trim() } : {}),
  };
  const canPreview = open && step === 'form' && datesValid && selectedIds.length > 0;
  const debouncedInput = useDebounced(input, 400);
  const preview = useQuery({
    queryKey: ['pricing', 'preview', JSON.stringify(debouncedInput), promotion?.id ?? ''],
    queryFn: () => pricingApi.preview({ ...debouncedInput, propertyIds: debouncedInput.propertyIds ?? selectedIds }, promotion?.id),
    enabled: canPreview,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const previewIds = selectedIds.slice(0, PREVIEW_ROWS);
  const prices = useQueries({
    queries: previewIds.map((id) => ({
      queryKey: pricingKeys.priceToday(id),
      queryFn: () => pricingApi.priceToday(id),
      enabled: open && step === 'form',
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const priceById = new Map(previewIds.map((id, i) => [id, prices[i]]));

  const belowMin = selected.filter((r) => {
    const p = priceById.get(r.id)?.data?.price;
    return p != null && isBelowMin(p, discount, r.geniusPct, r.minPrice, r.targetingPct);
  });

  const progress = usePromotion(step === 'form' ? null : resultId);
  const detail = progress.data;
  useEffect(() => {
    if (step === 'progress' && detail && detail.counts.pending === 0) setStep('report');
  }, [step, detail]);

  const submitting = create.isPending || update.isPending;
  const canSubmit = datesValid && selectedIds.length > 0 && discount >= 1 && discount <= 99 && !submitting;

  const submit = async () => {
    try {
      const res = isEdit
        ? await update.mutateAsync({ id: promotion!.id, input })
        : await create.mutateAsync(input);
      if (isEdit && res.counts.pending === 0) {
        // Nothing to send to Booking (e.g. only the name changed).
        toast.success(t('saved'));
        onOpenChange(false);
        onDone?.(res.id);
        return;
      }
      setResultId(res.id);
      setStep(res.counts.pending > 0 ? 'progress' : 'report');
    } catch (e) {
      toast.error(getApiErrorMessage(e) ?? t('error'));
    }
  };

  const retry = async (propertyId: string) => {
    if (!resultId) return;
    try {
      await targetAction.mutateAsync({ id: resultId, propertyId, action: 'retry' });
      setStep('progress');
    } catch (e) {
      toast.error(getApiErrorMessage(e) ?? t('error'));
    }
  };

  const objectsText = t('objects', { count: selectedIds.length });
  const datesText = fmtRange(range.from, range.to);
  const weekdaysText = weekdays ? ` (${weekdays.map((d) => tw(d)).join(', ')})` : '';
  const summary = `−${discount}% · ${objectsText} · ${datesText}${weekdaysText}`;

  const title = step === 'form' ? t(isEdit ? 'titleEdit' : 'titleNew') : step === 'progress' ? t(isEdit ? 'progressTitleEdit' : 'progressTitle') : t('reportHeader');

  const footer =
    step === 'form' ? (
      <div className="flex w-full flex-col gap-2.5">
        {isEdit ? (
          <p className="text-xs text-muted-foreground">
            {t('was', {
              text: `−${promotion!.discountPct}% · ${fmtRange(promotion!.stayFrom, promotion!.stayTo)} · ${t('objects', { count: promotion!.counts.on + promotion!.counts.pending })}`,
            })}
          </p>
        ) : null}
        <p className="text-sm">
          <span className="text-muted-foreground">{t(isEdit ? 'summaryEdit' : 'summary')} </span>
          <strong>{summary}</strong>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t(isEdit ? 'save' : 'launch')}
          </Button>
        </div>
      </div>
    ) : step === 'progress' ? (
      <div className="flex w-full justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t('collapse')}
        </Button>
      </div>
    ) : (
      <div className="flex w-full justify-end">
        <Button
          onClick={() => {
            onOpenChange(false);
            if (resultId) onDone?.(resultId);
          }}
        >
          {t('done')}
        </Button>
      </div>
    );

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
      <ResponsiveModalContent title={title} description={t('channel')} footer={footer} className="sm:max-w-xl">
        {step === 'form' ? (
          <div className="space-y-7 pb-2">
            <section className="space-y-2.5">
              <SectionTitle>{t('discount')}</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                {DISCOUNT_PRESETS.map((v) => (
                  <ChoiceChip
                    key={v}
                    selected={!(customPct > 0) && disc === v}
                    onClick={() => {
                      setDisc(v);
                      setCustom('');
                    }}
                  >
                    {v}%
                  </ChoiceChip>
                ))}
                <label
                  className={cn(
                    'inline-flex h-11 items-center gap-1.5 rounded-xl border px-3 text-sm',
                    customPct > 0 ? 'border-primary bg-primary/10 ring-1 ring-inset ring-primary' : 'border-border bg-card',
                  )}
                >
                  <span className="text-muted-foreground">{t('custom')}</span>
                  <input
                    inputMode="numeric"
                    aria-label={t('customAria')}
                    placeholder="—"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    className="w-8 bg-transparent text-right font-semibold outline-none"
                  />
                  <span>%</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{t('discountHint')}</p>
            </section>

            <section className="space-y-2.5">
              <SectionTitle>{t('dates')}</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {(['today', 'weekend', 'week', 'custom'] as const).map((p) => (
                  <ChoiceChip
                    key={p}
                    selected={preset === p}
                    onClick={() => {
                      if (p === 'custom' && preset !== 'custom') {
                        // Switching to «Свои даты» starts from the range that was selected.
                        const r = presetRange(preset, today);
                        setFrom(r.from);
                        setTo(r.to);
                      }
                      setPreset(p);
                    }}
                  >
                    {t(`presets.${p}`)}
                  </ChoiceChip>
                ))}
              </div>
              {preset === 'custom' ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    {t('from')}
                    <Input
                      type="date"
                      min={today}
                      value={from}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setFrom(v);
                        if (to < v) setTo(v);
                      }}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    {t('to')}
                    <Input
                      type="date"
                      min={from}
                      value={to}
                      onChange={(e) => e.target.value && setTo(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              <div className="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-sm">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {datesValid ? (
                  <span>
                    <strong>{datesText}</strong>
                    <span className="text-muted-foreground"> · {t('nights', { count: nights })} · {t('bookableNow')}</span>
                  </span>
                ) : (
                  <span className="text-destructive">{t('validationDates')}</span>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('weekdays')}</p>
                <div className="grid max-w-md grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d) => (
                    <ChoiceChip
                      key={d}
                      compact
                      selected={days.has(d)}
                      onClick={() => {
                        const next = new Set(days);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        if (next.size > 0) setDays(next);
                      }}
                    >
                      {tw(d)}
                    </ChoiceChip>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-2.5">
              <SectionTitle>{t('objectsTitle')}</SectionTitle>
              {!isEdit ? (
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'pick'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={scope === s}
                      onClick={() => setScope(s)}
                      className={cn(
                        'flex min-h-16 flex-col items-start gap-0.5 rounded-xl border px-3.5 py-3 text-left text-sm',
                        scope === s ? 'border-primary bg-primary/10 ring-1 ring-inset ring-primary' : 'border-border bg-card hover:border-primary/40',
                      )}
                    >
                      <span className="font-semibold">{t(s === 'all' ? 'scopeAll' : 'scopePick')}</span>
                      <span className="text-xs text-muted-foreground">
                        {s === 'all'
                          ? t('scopeAllHint', { count: eligibleRows.length })
                          : picked.size
                            ? t('scopePickHint', { count: eligibleRows.filter((r) => picked.has(r.id)).length })
                            : t('scopePickEmpty')}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {excludedRows.length > 0 && scope === 'all' && !isEdit ? (
                <p className="text-xs text-muted-foreground">
                  {t('excluded', {
                    list: excludedRows
                      .map((r) => `${r.name} — ${excludeReason(r)}`)
                      .join('; '),
                  })}
                </p>
              ) : null}
              {scope === 'pick' && pickedOutOfPilot.length > 0 ? (
                <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  {t('pilotPickedOut', { list: pickedOutOfPilot.map((r) => r.name).join(', ') })}
                </p>
              ) : null}
              {isEdit && offByHand.length > 0 ? (
                <p className="rounded-xl bg-muted px-3 py-2.5 text-xs text-foreground">
                  {t('editOffNote', { list: offByHand.map((x) => x.propertyName).join(', ') })}
                </p>
              ) : null}
              {scope === 'pick' ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      type="search"
                      aria-label={t('search')}
                      placeholder={t('search')}
                      className="pl-9"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                    {(rows ?? [])
                      .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
                      .map((r) => {
                        const available = r.bookingConnected && r.promotionsAccess !== 'denied' && r.inPilot !== false;
                        return (
                          <label
                            key={r.id}
                            className={cn(
                              'flex min-h-[52px] items-center gap-3 border-b border-border/60 px-3.5 py-2 last:border-b-0',
                              available ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
                            )}
                          >
                            <Checkbox
                              checked={available && picked.has(r.id)}
                              disabled={!available}
                              onCheckedChange={(v) => {
                                const next = new Set(picked);
                                if (v) next.add(r.id);
                                else next.delete(r.id);
                                setPicked(next);
                              }}
                              aria-label={r.name}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{r.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {!r.bookingConnected
                                  ? t('reasonNoBooking')
                                  : r.promotionsAccess === 'denied'
                                    ? t('reasonNoAccess')
                                    : r.inPilot === false
                                      ? t('reasonNotInPilot')
                                    : r.minPrice != null
                                      ? t('minShort', { price: fmtPrice(r.minPrice) })
                                      : t('noMinShort')}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                  <div className="flex gap-5 text-sm">
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPicked(new Set(eligibleRows.map((r) => r.id)))}>
                      {t('selectAll')}
                    </button>
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPicked(new Set())}>
                      {t('clear')}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {preview.data && preview.data.overlaps.length > 0 ? (
              <section className="space-y-2">
                <SectionTitle>{t('overlapsTitle')}</SectionTitle>
                {preview.data.overlaps.map((o) => (
                  <div
                    key={o.promotionId}
                    className="flex gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div>
                      <p className="font-semibold">
                        {t('overlapTitle', { name: o.name, pct: o.discountPct })}
                        {o.source === 'booking' ? t('overlapFromBooking') : ''}
                      </p>
                      <p className="text-[13px]">
                        {fmtRange(o.from, o.to)} · {t('objects', { count: o.propertyIds.length })}.{' '}
                        {o.visible === 'new'
                          ? t('overlapNew', { pct: discount })
                          : o.visible === 'existing'
                            ? t('overlapExisting', { pct: discount, other: o.discountPct })
                            : t('overlapEqual')}
                      </p>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            <section className="space-y-2.5">
              <SectionTitle>{t('previewTitle')}</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_6.5rem] gap-2 bg-muted/60 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                  <span>{t('previewObject')}</span>
                  <span className="text-right">{t('previewRegular')}</span>
                  <span className="text-right">{t('previewGenius')}</span>
                </div>
                {selected.length === 0 ? (
                  <p className="px-3.5 py-3 text-sm text-muted-foreground">{t('previewEmpty')}</p>
                ) : (
                  selected.slice(0, PREVIEW_ROWS).map((r) => {
                    const q2 = priceById.get(r.id);
                    const price = q2?.data?.price ?? null;
                    const currency = q2?.data?.currency;
                    const below = price != null && isBelowMin(price, discount, r.geniusPct, r.minPrice, r.targetingPct);
                    return (
                      <div
                        key={r.id}
                        className={cn(
                          'grid grid-cols-[minmax(0,1fr)_7.5rem_6.5rem] items-center gap-2 border-t border-border/60 px-3.5 py-2.5 text-sm',
                          below && protect && 'opacity-60',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{r.name}</span>
                          {price != null && r.targetingPct ? (
                            <span className="block text-xs text-muted-foreground">
                              {t('previewTargeting', {
                                pct: r.targetingPct,
                                price: fmtPrice(Math.round(guestPrice(price, discount, r.geniusPct, r.targetingPct) * 100) / 100, currency),
                              })}
                            </span>
                          ) : null}
                          {below ? (
                            <span className="block text-xs text-amber-700 dark:text-amber-400">
                              {t('belowMin', { min: fmtPrice(r.minPrice, currency) })}
                              {protect ? ` — ${t('willSkip')}` : ''}
                            </span>
                          ) : null}
                        </span>
                        <span className="whitespace-nowrap text-right">
                          {q2?.isLoading ? (
                            <span className="text-xs text-muted-foreground">{t('previewLoading')}</span>
                          ) : price == null ? (
                            <span className="text-xs text-muted-foreground">{t('previewNoPrice')}</span>
                          ) : (
                            <>
                              <s className="text-xs text-muted-foreground">{fmtPrice(price)}</s>{' '}
                              <strong className="text-emerald-700 dark:text-emerald-400">
                                {fmtPrice(Math.round(guestPrice(price, discount) * 100) / 100, currency)}
                              </strong>
                            </>
                          )}
                        </span>
                        <span className={cn('whitespace-nowrap text-right font-semibold', below && 'text-amber-700 dark:text-amber-400')}>
                          {price == null ? '—' : fmtPrice(Math.round(guestPrice(price, discount, r.geniusPct) * 100) / 100, currency)}
                        </span>
                      </div>
                    );
                  })
                )}
                {selected.length > PREVIEW_ROWS ? (
                  <p className="border-t border-border/60 px-3.5 py-2 text-xs text-muted-foreground">
                    {t('previewMore', { count: selected.length - PREVIEW_ROWS })}
                  </p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3">
                <Checkbox checked={protect} onCheckedChange={(v) => setProtect(v === true)} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{t('protect')}</span>
                  <span className="block text-xs text-muted-foreground">{t('protectHint')}</span>
                </span>
              </label>
              {belowMin.length > 0 ? (
                <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  {t(protect ? 'belowSkipped' : 'belowWarning', { list: belowMin.map((r) => r.name).join(', ') })}
                </p>
              ) : null}
            </section>

            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              {t('name')}
              <Input value={name} maxLength={120} placeholder={t('namePlaceholder', { pct: discount })} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
        ) : step === 'progress' ? (
          <div className="space-y-4">
            {detail ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t('progressText', { done: detail.counts.total - detail.counts.pending, total: detail.counts.total })}
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${detail.counts.total ? ((detail.counts.total - detail.counts.pending) / detail.counts.total) * 100 : 0}%` }}
                  />
                </div>
                <ul className="overflow-hidden rounded-xl border border-border">
                  {detail.targets.map((x) => (
                    <li key={x.propertyId} className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-3.5 py-2 text-sm last:border-b-0">
                      <span className="truncate">{x.propertyName}</span>
                      <TargetStateBadge state={x.state} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            <p className="text-xs text-muted-foreground">{t('progressHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {detail ? <Report detail={detail} onRetry={retry} retrying={targetAction.isPending} errorLabel={errorLabel} /> : null}
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function Report({
  detail,
  onRetry,
  retrying,
  errorLabel,
}: {
  detail: PromotionDetail;
  onRetry: (propertyId: string) => void;
  retrying: boolean;
  errorLabel: (code: string | null) => string;
}) {
  const t = useTranslations('pricing.form');
  const dry = detail.targets.some((x) => x.state === 'dry_run');
  const ok = detail.targets.filter((x) => x.state === 'dry_run' || (x.state === 'on' && x.confirmed));
  /** Accepted by the channel, but Booking's own list does not show it (yet). */
  const waiting = detail.targets.filter((x) => x.state === 'on' && !x.confirmed);
  const problems = detail.targets.filter((x) => x.state === 'error' || x.state === 'skipped');
  const total = detail.targets.length;
  const kind = dry ? 'dry' : ok.length === total ? 'all' : ok.length > 0 ? 'part' : waiting.length > 0 ? 'waiting' : 'none';
  return (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            kind === 'none'
              ? 'bg-red-100 dark:bg-red-500/15'
              : kind === 'waiting'
                ? 'bg-amber-100 dark:bg-amber-500/15'
                : 'bg-emerald-100 dark:bg-emerald-500/15',
          )}
        >
          {kind === 'none' ? (
            <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden />
          ) : kind === 'waiting' ? (
            <Clock className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />
          ) : (
            <Check className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          )}
        </span>
        <div>
          <p className="font-semibold">
            {kind === 'dry'
              ? t('reportDry')
              : kind === 'all'
                ? t('reportAll')
                : kind === 'part'
                  ? t('reportTitle', { ok: ok.length, total })
                  : kind === 'waiting'
                    ? t('reportWaiting', { sent: waiting.length, total })
                    : t('reportNone')}
          </p>
          <p className="text-sm text-muted-foreground">
            {kind === 'dry'
              ? t('reportDrySub')
              : kind === 'none'
                ? t('reportNoneSub')
                : kind === 'waiting'
                  ? t('reportWaitingSub')
                  : t('reportSub')}
          </p>
        </div>
      </div>
      {problems.map((x) => (
        <div
          key={x.propertyId}
          className={cn(
            'space-y-1.5 rounded-xl border px-3.5 py-3 text-sm',
            x.state === 'error'
              ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100'
              : 'border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
          )}
        >
          <p className="font-semibold">{x.propertyName}</p>
          <p className="text-[13px]">{errorLabel(x.lastErrorCode)}</p>
          {x.state === 'error' ? (
            <Button size="sm" variant="outline" disabled={retrying} onClick={() => onRetry(x.propertyId)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ))}
      {ok.length + waiting.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-border">
          {ok.map((x) => (
            <li key={x.propertyId} className="flex min-h-11 items-center gap-2.5 border-b border-border/60 px-3.5 text-sm last:border-b-0">
              <Check className="h-4 w-4 text-emerald-600" aria-hidden />
              {x.propertyName}
            </li>
          ))}
          {waiting.map((x) => (
            <li key={x.propertyId} className="flex min-h-11 flex-wrap items-center gap-x-2.5 border-b border-border/60 px-3.5 py-2 text-sm last:border-b-0">
              <Clock className="h-4 w-4 text-amber-600" aria-hidden />
              <span>{x.propertyName}</span>
              <span className="text-xs text-amber-700 dark:text-amber-400">{t('reportWaitingRow')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
