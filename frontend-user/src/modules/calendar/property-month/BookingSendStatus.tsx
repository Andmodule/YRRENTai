'use client';

import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDateLocale } from '@/hooks/useDateLocale';
import { cn } from '@/lib/utils';
import { useStayRangeFormatter } from '@/modules/pricing/components/shared';
import { addDaysYmd } from '@/modules/pricing/lib/pricing-ui';
import type { CalendarDatesJob } from '../calendar-dates-api';
import { resendRange, sendStatus } from '../lib/booking-send';

/**
 * The property's last Booking run, always above the month: on a phone the panel that sent it lives in a sheet
 * that closes, and «the price did not update» could not be told from «it did not reach Booking».
 * Refused or broken-off nights can be picked again with one tap.
 */
export function BookingSendStatus({
  job,
  monthFrom,
  monthTo,
  onPick,
}: {
  job: CalendarDatesJob | null;
  monthFrom: string;
  monthTo: string;
  onPick: (from: string, to: string) => void;
}) {
  const t = useTranslations('calendar.propertyMonth.sendStatus');
  const dateLocale = useDateLocale();
  const fmtRange = useStayRangeFormatter();
  const status = sendStatus(job);
  if (!job || !status) return null;

  const what = t(`what.${job.action}`);
  const range = fmtRange(job.dateFrom, addDaysYmd(job.dateToExclusive, -1));
  // The device's time; the year only for a run of another year (the server keeps the last run until it restarts).
  const atDate = 'at' in status ? new Date(status.at) : null;
  const at = atDate
    ? format(atDate, atDate.getFullYear() === new Date().getFullYear() ? 'd MMM, HH:mm' : 'd MMM yyyy, HH:mm', { locale: dateLocale })
    : '';
  const auto = job.source === 'auto' ? ` ${t('auto')}` : '';
  // Only a price run is sent again from here (opening / closing — «Продажи»), and only nights of this month.
  const again = job.action === 'price' ? resendRange(job) : null;
  const pick =
    again && again.from <= monthTo && again.to >= monthFrom
      ? { from: again.from < monthFrom ? monthFrom : again.from, to: again.to > monthTo ? monthTo : again.to }
      : null;

  const tone =
    status.kind === 'running'
      ? 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100'
      : status.kind === 'ok' || status.kind === 'nothing'
        ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100'
        : 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100';

  const text =
    status.kind === 'running'
      ? t('running', { what, range, done: status.done, total: status.total })
      : status.kind === 'ok'
        ? t('ok', { what, range, at })
        : status.kind === 'nothing'
          ? t('nothing', { range, at })
          : status.kind === 'unchecked'
            ? t('unchecked', { what, range, at })
            : status.kind === 'partial'
              ? [
                  t('partial', { what, range, at }),
                  status.failedNights > 0 ? t('partialFailed', { count: status.failedNights }) : null,
                  status.mismatched > 0 ? t('partialMismatch', { count: status.mismatched }) : null,
                ]
                  .filter(Boolean)
                  .join(' ')
              : t(status.kind, { what, range, at });

  return (
    <div role="status" aria-label={t('aria')} className={cn('mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', tone)}>
      {status.kind === 'running' ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : status.kind === 'ok' || status.kind === 'nothing' ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <p className="min-w-0 flex-1">
        {text}
        {auto}
      </p>
      {pick ? (
        <Button type="button" size="sm" variant="outline" className="h-11 shrink-0 bg-background" onClick={() => onPick(pick.from, pick.to)}>
          {t('pickAgain')}
        </Button>
      ) : null}
    </div>
  );
}
