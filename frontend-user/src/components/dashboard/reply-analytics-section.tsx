'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { endOfDay, format, parse, startOfDay, subDays } from 'date-fns';
import { Bot, Percent, UserRound } from 'lucide-react';
import { useReplyAnalytics } from '@/hooks/use-reply-analytics';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Preset = 'last30' | 'custom';

export function ReplyAnalyticsSection() {
  const t = useTranslations('dashboard.analytics');
  const [preset, setPreset] = useState<Preset>('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo((): { from: Date; to: Date } | null => {
    const now = new Date();
    if (preset === 'last30') return { from: subDays(now, 30), to: now };
    if (preset === 'custom' && customFrom && customTo) {
      const from = startOfDay(parse(customFrom, 'yyyy-MM-dd', new Date()));
      const to = endOfDay(parse(customTo, 'yyyy-MM-dd', new Date()));
      if (from.getTime() > to.getTime()) return null;
      return { from, to };
    }
    return null;
  }, [preset, customFrom, customTo]);

  const { data, isLoading, isValidating } = useReplyAnalytics(range);

  function selectPreset(next: Preset) {
    setPreset(next);
    if (next === 'custom') {
      const now = new Date();
      setCustomFrom(format(subDays(now, 30), 'yyyy-MM-dd'));
      setCustomTo(format(now, 'yyyy-MM-dd'));
    }
  }

  const incompleteCustom = preset === 'custom' && (!customFrom || !customTo);
  const invalidCustom =
    preset === 'custom' && Boolean(customFrom && customTo) && range === null;
  const showSkeleton =
    !invalidCustom && (incompleteCustom || (range != null && (isLoading || isValidating)));

  const analyticsCards = [
    {
      key: 'ai',
      icon: Bot,
      accent:
        'border border-blue-600/25 bg-blue-500/10 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400',
      value: data?.ai ?? 0,
      label: t('aiReplies'),
    },
    {
      key: 'staff',
      icon: UserRound,
      accent:
        'border border-amber-600/25 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400',
      value: data?.staff ?? 0,
      label: t('manualReplies'),
    },
    {
      key: 'percent',
      icon: Percent,
      accent:
        'border border-violet-600/25 bg-violet-500/10 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-400',
      value: data?.aiPercent == null ? '—' : `${data.aiPercent}%`,
      label: t('aiShare'),
    },
  ];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card py-3 sm:space-y-4 sm:rounded-xl sm:py-6 dark:border-slate-800/80 dark:bg-slate-950/20">
      <div className="flex flex-col gap-2 px-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:text-xs">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:mt-1 sm:text-sm">{t('subtitle')}</p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <div
            className="inline-flex self-start rounded-md border border-border bg-muted/70 p-0.5 sm:self-auto dark:border-slate-700/80 dark:bg-slate-900/40"
            role="group"
            aria-label={t('ariaPeriod')}
          >
            <button
              type="button"
              onClick={() => selectPreset('last30')}
              className={cn(
                'rounded px-2 py-1 text-[11px] tabular-nums transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs',
                preset === 'last30'
                  ? 'bg-background text-foreground shadow-sm dark:bg-slate-700/70 dark:text-slate-200'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground dark:text-slate-500 dark:hover:bg-slate-800/80 dark:hover:text-slate-300',
              )}
            >
              {t('period30d')}
            </button>
            <button
              type="button"
              onClick={() => selectPreset('custom')}
              className={cn(
                'rounded px-2 py-1 text-[11px] transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs',
                preset === 'custom'
                  ? 'bg-background text-foreground shadow-sm dark:bg-slate-700/70 dark:text-slate-200'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground dark:text-slate-500 dark:hover:bg-slate-800/80 dark:hover:text-slate-300',
              )}
            >
              {t('periodChoose')}
            </button>
          </div>

          {preset === 'custom' && (
            <div className="flex flex-wrap items-end gap-3 sm:justify-end">
              <div className="space-y-1">
                <Label htmlFor="analytics-from" className="text-[10px] font-normal text-muted-foreground">
                  {t('customFrom')}
                </Label>
                <Input
                  id="analytics-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 w-[140px] text-xs dark:border-slate-700/80 dark:bg-slate-900/50 dark:text-slate-300"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analytics-to" className="text-[10px] font-normal text-muted-foreground">
                  {t('customTo')}
                </Label>
                <Input
                  id="analytics-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 w-[140px] text-xs dark:border-slate-700/80 dark:bg-slate-900/50 dark:text-slate-300"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {invalidCustom && (
        <p className="px-3 text-xs text-destructive sm:px-6">{t('invalidRange')}</p>
      )}

      <div className="grid grid-cols-3 gap-2 px-3 sm:gap-4 sm:px-6">
        {analyticsCards.map(({ key, icon: Icon, accent, value, label }) => (
          <div
            key={key}
            className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/40 p-2 shadow-none sm:flex-row sm:items-center sm:gap-4 sm:rounded-xl sm:p-5 dark:border-slate-700/80 dark:bg-slate-800/50 dark:sm:shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:h-11 sm:w-11 sm:rounded-lg ${accent}`}
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="line-clamp-2 text-[9px] uppercase leading-tight tracking-wide text-muted-foreground sm:line-clamp-none sm:text-xs">
                {label}
              </p>
              {invalidCustom ? (
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground sm:mt-1 sm:text-2xl dark:text-white">
                  —
                </p>
              ) : showSkeleton ? (
                <Skeleton className="mx-auto mt-0.5 h-5 w-9 bg-muted sm:mx-0 sm:mt-1 sm:h-7 sm:w-12 dark:bg-slate-700" />
              ) : (
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground sm:mt-1 sm:text-2xl dark:text-white">
                  {value}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
