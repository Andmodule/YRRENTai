'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { cn } from '@/lib/utils';
import type { BookingWeekday, RuleInput, RuleStepInput, RuleUnit, RuleView } from '../api';
import { useRulesMutations, usePriceToday, usePricingAccess, usePricingProperties } from '../hooks';
import {
  TIME_WINDOWS,
  WEEKDAYS,
  findShadowedSteps,
  guestPrice,
  isBelowMin,
  normalizeWeekdays,
  roundMoney,
  ruleTemplate,
  sortSteps,
  timeWindowKey,
  type TimeWindowKey,
} from '../lib/pricing-ui';
import { ChoiceChip, SectionTitle, useStepWhen, usePriceFormatter } from './shared';

const HORIZONS = [3, 6, 12] as const;
const MAX_STEPS = 8;
const MAX_DAYS = 30;
const MAX_HOURS = 720;

/** A step while it is being edited: raw text, so a half-typed number does not jump around. */
type Draft = {
  key: string;
  pct: string;
  unit: RuleUnit;
  value: string;
  window: TimeWindowKey;
  customStart: string;
  customEnd: string;
};

let draftSeq = 0;
const nextKey = () => `step-${++draftSeq}`;

function toDraft(s: RuleStepInput): Draft {
  const window = timeWindowKey(s.bookTime);
  return {
    key: nextKey(),
    pct: String(s.discountPct),
    unit: s.unit,
    value: String(s.value),
    window,
    customStart: String(s.bookTime?.start ?? 9),
    customEnd: String(s.bookTime?.end ?? 18),
  };
}

function emptyDraft(): Draft {
  return toDraft({ discountPct: 10, unit: 'day', value: 1, bookTime: null });
}

/** null while any field is incomplete or out of Booking's range. */
function toStep(d: Draft): RuleStepInput | null {
  const discountPct = Number.parseInt(d.pct, 10);
  const value = Number.parseInt(d.value, 10);
  if (!Number.isInteger(discountPct) || discountPct < 1 || discountPct > 99) return null;
  if (!Number.isInteger(value) || value < 1 || value > (d.unit === 'day' ? MAX_DAYS : MAX_HOURS)) return null;
  let bookTime: RuleStepInput['bookTime'] = null;
  if (d.window === 'custom') {
    const start = Number.parseInt(d.customStart, 10);
    const end = Number.parseInt(d.customEnd, 10);
    if (!(start >= 0 && end <= 24 && start < end)) return null;
    bookTime = { start, end };
  } else if (d.window !== 'any') {
    bookTime = TIME_WINDOWS[d.window];
  }
  return { discountPct, unit: d.unit, value, bookTime };
}

export interface RuleFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing: the rule is created anew and this one is switched off. */
  rule?: RuleView | null;
}

export function RuleFormSheet({ open, onOpenChange, rule }: RuleFormSheetProps) {
  const t = useTranslations('pricing.rules.form');
  const tw = useTranslations('pricing.form.weekdayShort');
  const stepWhen = useStepWhen();
  const fmtPrice = usePriceFormatter();
  const access = usePricingAccess();
  const { data: rows } = usePricingProperties(open);
  const { create } = useRulesMutations();
  const isEdit = !!rule;

  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Draft[]>([]);
  const [days, setDays] = useState<Set<BookingWeekday>>(new Set(WEEKDAYS));
  const [horizon, setHorizon] = useState<number>(6);
  const [scope, setScope] = useState<'all' | 'pick'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [protect, setProtect] = useState(true);

  // Reset every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setQ('');
    if (rule) {
      setName(rule.name);
      setSteps(rule.steps.map(toDraft));
      setDays(new Set(rule.weekdays?.length ? rule.weekdays : WEEKDAYS));
      setHorizon(HORIZONS.includes(rule.horizonMonths as 3 | 6 | 12) ? rule.horizonMonths : 6);
      setScope('pick');
      // Objects switched off by hand stay off: editing must not turn them back on.
      setPicked(new Set(rule.properties.filter((p) => p.state !== 'off').map((p) => p.propertyId)));
      setProtect(rule.protectMinPrice);
    } else {
      setName(t('defaultName'));
      setSteps(ruleTemplate().map(toDraft));
      setDays(new Set(WEEKDAYS));
      setHorizon(6);
      setScope('all');
      setPicked(new Set());
      setProtect(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const eligibleRows = useMemo(
    () => (rows ?? []).filter((r) => r.bookingConnected && r.promotionsAccess !== 'denied'),
    [rows],
  );
  const excludedRows = useMemo(
    () => (rows ?? []).filter((r) => !r.bookingConnected || r.promotionsAccess === 'denied'),
    [rows],
  );
  const selected = useMemo(
    () => (scope === 'all' ? eligibleRows : eligibleRows.filter((r) => picked.has(r.id))),
    [scope, eligibleRows, picked],
  );

  const entries = useMemo(
    () => steps.flatMap((d) => {
      const step = toStep(d);
      return step ? [{ key: d.key, step }] : [];
    }),
    [steps],
  );
  const valid = useMemo(() => entries.map((e) => e.step), [entries]);
  const allValid = steps.length > 0 && entries.length === steps.length;
  const duplicates = useMemo(() => {
    const keys = valid.map((s) => `${s.unit}:${s.value}:${s.bookTime?.start ?? ''}-${s.bookTime?.end ?? ''}`);
    return new Set(keys).size !== keys.length;
  }, [valid]);
  /** step key → the step that already gives the same or a bigger discount at the same moments */
  const coveringByKey = useMemo(
    () => new Map(findShadowedSteps(valid).map(([i, j]) => [entries[i]!.key, valid[j]!] as const)),
    [valid, entries],
  );

  const sample = selected[0];
  const price = usePriceToday(sample?.id ?? null, open && !!sample);
  const rack = price.data?.price ?? null;
  const currency = price.data?.currency;
  const belowMin =
    sample && rack != null
      ? valid.filter((s) => isBelowMin(rack, s.discountPct, sample.geniusPct, sample.minPrice))
      : [];

  const canSubmit = allValid && !duplicates && selected.length > 0 && name.trim().length > 0 && !create.isPending;

  const update = (key: string, patch: Partial<Draft>) =>
    setSteps((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const submit = () => {
    const input: RuleInput = {
      name: name.trim(),
      steps: sortSteps(valid),
      weekdays: normalizeWeekdays([...days]),
      horizonMonths: horizon,
      propertyIds: scope === 'pick' || isEdit ? selected.map((r) => r.id) : undefined,
      protectMinPrice: protect,
      ...(rule ? { replaceGroupId: rule.groupId } : {}),
    };
    create.mutate(input, {
      onSuccess: (view) => {
        toast.success(access.dryRun ? t('createdDry') : t('created'));
        for (const w of view.warnings ?? []) toast.warning(w);
        onOpenChange(false);
      },
      onError: (e) => toast.error(getApiErrorMessage(e) ?? t('error')),
    });
  };

  const footer = (
    <div className="flex w-full flex-col gap-2.5">
      <p className="text-sm">
        <span className="text-muted-foreground">{t('summary')} </span>
        <strong>{t('summaryValue', { steps: valid.length, objects: selected.length, months: horizon })}</strong>
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={create.isPending}>
          {t('cancel')}
        </Button>
        <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
          {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {t(isEdit ? 'saveEdit' : 'launch')}
        </Button>
      </div>
    </div>
  );

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
      <ResponsiveModalContent
        title={t(isEdit ? 'titleEdit' : 'titleNew')}
        description={t('channel')}
        footer={footer}
        className="sm:max-w-xl"
      >
        <div className="space-y-6 pb-2">
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            {t('name')}
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>

          <section className="space-y-2.5">
            <SectionTitle>{t('stepsTitle')}</SectionTitle>
            <p className="text-xs text-muted-foreground">{t('stepsHint')}</p>

            <ol className="space-y-3">
              {steps.map((d, i) => {
                const step = toStep(d);
                const covering = coveringByKey.get(d.key);
                return (
                  <li key={d.key} className="space-y-3 rounded-xl border border-border bg-card px-3.5 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{t('stepN', { n: i + 1 })}</span>
                      <button
                        type="button"
                        aria-label={t('removeStep')}
                        disabled={steps.length <= 1}
                        onClick={() => setSteps((prev) => prev.filter((x) => x.key !== d.key))}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
                      <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                        {t('whenLabel')}
                        <div className="flex gap-2">
                          <Input
                            inputMode="numeric"
                            aria-label={t('whenValueAria', { n: i + 1 })}
                            className="w-20"
                            value={d.value}
                            onChange={(e) => update(d.key, { value: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                          />
                          <Select
                            aria-label={t('whenUnitAria', { n: i + 1 })}
                            value={d.unit}
                            onChange={(e) => update(d.key, { unit: e.target.value as RuleUnit })}
                          >
                            <option value="day">{t('unitDay')}</option>
                            <option value="hour">{t('unitHour')}</option>
                          </Select>
                        </div>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                        {t('discountLabel')}
                        <div className="flex items-center gap-1.5">
                          <Input
                            inputMode="numeric"
                            aria-label={t('discountAria', { n: i + 1 })}
                            className="w-full"
                            value={d.pct}
                            onChange={(e) => update(d.key, { pct: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                          />
                          <span className="text-sm font-semibold text-foreground">%</span>
                        </div>
                      </label>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">{t('timeLabel')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(['any', 'morning', 'day', 'evening', 'custom'] as const).map((w) => (
                          <ChoiceChip key={w} selected={d.window === w} onClick={() => update(d.key, { window: w })}>
                            {t(`window.${w}`)}
                          </ChoiceChip>
                        ))}
                      </div>
                      {d.window === 'custom' ? (
                        <div className="flex items-center gap-2 pt-1 text-sm">
                          <Select
                            aria-label={t('timeFromAria', { n: i + 1 })}
                            className="w-24"
                            value={d.customStart}
                            onChange={(e) => update(d.key, { customStart: e.target.value })}
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>
                                {h}:00
                              </option>
                            ))}
                          </Select>
                          <span aria-hidden>–</span>
                          <Select
                            aria-label={t('timeToAria', { n: i + 1 })}
                            className="w-24"
                            value={d.customEnd}
                            onChange={(e) => update(d.key, { customEnd: e.target.value })}
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h + 1} value={h + 1}>
                                {h + 1}:00
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                    </div>

                    {!step ? (
                      <p className="text-xs text-destructive">{t('stepInvalid', { days: MAX_DAYS, hours: MAX_HOURS })}</p>
                    ) : covering ? (
                      <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{t('shadowed', { other: stepWhen(covering.unit, covering.value, covering.bookTime), pct: covering.discountPct })}</span>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {duplicates ? <p className="text-xs text-destructive">{t('duplicates')}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={steps.length >= MAX_STEPS} onClick={() => setSteps((prev) => [...prev, emptyDraft()])}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('addStep')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setSteps(ruleTemplate().map(toDraft))}>
                <Wand2 className="h-4 w-4" aria-hidden />
                {t('useTemplate')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('hoursHint')}</p>
          </section>

          <section className="space-y-2.5">
            <SectionTitle>{t('daysTitle')}</SectionTitle>
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
            <p className="text-xs text-muted-foreground">{t('daysHint')}</p>
          </section>

          <section className="space-y-2.5">
            <SectionTitle>{t('horizonTitle')}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {HORIZONS.map((m) => (
                <ChoiceChip key={m} selected={horizon === m} onClick={() => setHorizon(m)}>
                  {t('horizonOption', { count: m })}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('horizonHint')}</p>
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
                      {s === 'all' ? t('scopeAllHint', { count: eligibleRows.length }) : t('scopePickHint', { count: picked.size })}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {excludedRows.length > 0 && scope === 'all' && !isEdit ? (
              <p className="text-xs text-muted-foreground">
                {t('excluded', { list: excludedRows.map((r) => r.name).join(', ') })}
              </p>
            ) : null}
            {scope === 'pick' || isEdit ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input type="search" aria-label={t('search')} placeholder={t('search')} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
                  {eligibleRows
                    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
                    .map((r) => (
                      <label key={r.id} className="flex min-h-[48px] cursor-pointer items-center gap-3 border-b border-border/60 px-3.5 py-2 last:border-b-0">
                        <Checkbox
                          checked={picked.has(r.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(picked);
                            if (v) next.add(r.id);
                            else next.delete(r.id);
                            setPicked(next);
                          }}
                          aria-label={r.name}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                      </label>
                    ))}
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

          {sample && valid.length > 0 ? (
            <section className="space-y-2.5">
              <SectionTitle>{t('previewTitle')}</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] gap-2 bg-muted/60 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                  <span>{sample.name}</span>
                  <span className="text-right">{t('previewRegular')}</span>
                  <span className="text-right">{t('previewGenius')}</span>
                </div>
                {sortSteps(valid).map((s, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-2 border-t border-border/60 px-3.5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{stepWhen(s.unit, s.value, s.bookTime)}</span>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">−{s.discountPct}%</span>
                    </span>
                    <span className="text-right tabular-nums">
                      {rack == null ? '—' : fmtPrice(roundMoney(guestPrice(rack, s.discountPct)), currency)}
                    </span>
                    <span className="text-right tabular-nums">
                      {rack == null ? '—' : fmtPrice(roundMoney(guestPrice(rack, s.discountPct, sample.geniusPct)), currency)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
            </section>
          ) : null}

          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3">
            <Checkbox checked={protect} onCheckedChange={(v) => setProtect(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{t('protect')}</span>
              <span className="block text-xs text-muted-foreground">{t('protectHint')}</span>
            </span>
          </label>
          {belowMin.length > 0 && sample ? (
            <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              {t(protect ? 'belowSkipped' : 'belowWarning', { object: sample.name, pct: Math.min(...belowMin.map((s) => s.discountPct)) })}
            </p>
          ) : null}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
