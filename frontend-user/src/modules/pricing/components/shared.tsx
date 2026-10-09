'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useCallback } from 'react';
import { format } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { useDateLocale } from '@/hooks/useDateLocale';
import { cn } from '@/lib/utils';
import type { BookTime, PromotionSummary, PromotionTargetState, RuleUnit } from '../api';
import { type CampaignHealth, ymdToDate } from '../lib/pricing-ui';

/** «за 3 дня до заезда», «за 12 часов до заезда, бронь 6:00–12:00». */
export function useStepWhen() {
  const t = useTranslations('pricing.rules.when');
  return useCallback(
    (unit: RuleUnit, value: number, bookTime: BookTime | null): string => {
      const before = t(unit, { count: value });
      return bookTime ? `${before}, ${t('bookTime', { from: `${bookTime.start}:00`, to: `${bookTime.end}:00` })}` : before;
    },
    [t],
  );
}

/** The state a person should look at first among a step's / rule's objects. */
export function worstState(counts: Record<PromotionTargetState, number>): PromotionTargetState {
  for (const s of ['error', 'skipped', 'pending', 'dry_run', 'on'] as const) {
    if (counts[s] > 0) return s;
  }
  return 'off';
}

/** «6–12 октября», «28 сентября – 1 октября», «6 октября». */
export function useStayRangeFormatter() {
  const dateLocale = useDateLocale();
  return useCallback(
    (from: string | null, to: string | null): string => {
      if (!from || !to) return '—';
      const a = ymdToDate(from);
      const b = ymdToDate(to);
      if (from === to) return format(a, 'd MMMM', { locale: dateLocale });
      if (from.slice(0, 7) === to.slice(0, 7)) {
        return `${format(a, 'd', { locale: dateLocale })}–${format(b, 'd MMMM', { locale: dateLocale })}`;
      }
      return `${format(a, 'd MMMM', { locale: dateLocale })} – ${format(b, 'd MMMM', { locale: dateLocale })}`;
    },
    [dateLocale],
  );
}

/** «420 PLN» — Booking prices are major units of the channel currency. */
export function usePriceFormatter() {
  const locale = useLocale();
  return useCallback(
    (amount: number | null | undefined, currency?: string | null): string => {
      if (amount == null || !Number.isFinite(amount)) return '—';
      const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
      return currency ? `${n} ${currency}` : n;
    },
    [locale],
  );
}

const CAMPAIGN_TONE: Record<PromotionSummary['derivedStatus'], string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  finished: 'bg-muted text-muted-foreground',
  off: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
};

const HEALTH_TONE = 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300';

/** `health` (see `campaignHealth`) overrides «Действует» for a discount that is not really on Booking. */
export function CampaignStatusBadge({ status, health = 'ok' }: { status: PromotionSummary['derivedStatus']; health?: CampaignHealth }) {
  const t = useTranslations('pricing.promotions.status');
  const flagged = status === 'active' && health !== 'ok';
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        flagged ? HEALTH_TONE : CAMPAIGN_TONE[status],
      )}
    >
      {flagged ? t(health === 'not_sent' ? 'notSent' : 'unconfirmed') : t(status)}
    </span>
  );
}

const TARGET_TONE: Record<PromotionTargetState, string> = {
  pending: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  on: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  off: 'bg-muted text-muted-foreground',
  error: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  skipped: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  dry_run: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
};

/** `confirmed: false` on a switched-on target = sent, but Booking does not list it (yet) — never shown as «Включена». */
export function TargetStateBadge({ state, confirmed }: { state: PromotionTargetState; confirmed?: boolean }) {
  const t = useTranslations('pricing.detail.targetState');
  const unconfirmed = state === 'on' && confirmed === false;
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        unconfirmed ? TARGET_TONE.skipped : TARGET_TONE[state],
      )}
    >
      {state === 'pending' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
      {unconfirmed ? t('unconfirmed') : t(state)}
    </span>
  );
}

/** Human text for a target error / skip code. */
export function useErrorLabel() {
  const t = useTranslations('pricing.detail.errors');
  return useCallback(
    (code: string | null | undefined): string => {
      if (!code) return '';
      return t.has(code) ? t(code) : t('unknown');
    },
    [t],
  );
}

/** Toggle chip used for discount %, date presets and weekdays. */
export function ChoiceChip({
  selected,
  compact = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected: boolean;
  /** Fills a grid cell (weekdays, Genius levels). `cn` only joins classes, so sizes can't be overridden via className. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center justify-center rounded-xl border text-sm font-medium transition-colors',
        compact ? 'h-10 min-w-0 px-1' : 'h-11 min-w-14 px-3.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-primary bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary'
          : 'border-border bg-card text-foreground hover:border-primary/40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  confirmLabel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const t = useTranslations('pricing.form');
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        title={title}
        stackAboveTaskLayer
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">{text}</p>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
