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
      accent: 'bg-blue-500/15 border border-blue-500/30 text-blue-400',
      value: data?.ai ?? 0,
      label: t('aiReplies'),
    },
    {
      key: 'staff',
      icon: UserRound,
      accent: 'bg-amber-500/15 border border-amber-500/30 text-amber-400',
      value: data?.staff ?? 0,
      label: t('manualReplies'),
    },
    {
      key: 'percent',
      icon: Percent,
      accent: 'bg-violet-500/15 border border-violet-500/30 text-violet-400',
      value: data?.aiPercent == null ? '—' : `${data.aiPercent}%`,
      label: t('aiShare'),
    },
  ];

  return (
    <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/20 py-3 sm:space-y-4 sm:rounded-xl sm:py-6">
      {/* px-0 на верхнем ряду: заголовок и подпись совпадают по левому краю с «Добро пожаловать» на главной странице */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 sm:text-xs">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-slate-400 sm:mt-1 sm:text-sm">{t('subtitle')}</p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 pr-3 sm:items-end sm:pr-6">
          <div
            className="inline-flex self-start rounded-md border border-slate-700/80 bg-slate-900/40 p-0.5 sm:self-auto"
            role="group"
            aria-label={t('ariaPeriod')}
          >
            <button
              type="button"
              onClick={() => selectPreset('last30')}
              className={cn(
                'rounded px-2 py-1 text-[11px] tabular-nums transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs',
                preset === 'last30'
                  ? 'bg-slate-700/70 text-slate-200'
                  : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-300',
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
                  ? 'bg-slate-700/70 text-slate-200'
                  : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-300',
              )}
            >
              {t('periodChoose')}
            </button>
          </div>

          {preset === 'custom' && (
            <div className="flex flex-wrap items-end gap-3 sm:justify-end">
              <div className="space-y-1">
                <Label htmlFor="analytics-from" className="text-[10px] font-normal text-slate-500">
                  {t('customFrom')}
                </Label>
                <Input
                  id="analytics-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 w-[140px] border-slate-700/80 bg-slate-900/50 text-xs text-slate-300"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analytics-to" className="text-[10px] font-normal text-slate-500">
                  {t('customTo')}
                </Label>
                <Input
                  id="analytics-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 w-[140px] border-slate-700/80 bg-slate-900/50 text-xs text-slate-300"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {invalidCustom && (
        <p className="px-0 text-xs text-destructive">{t('invalidRange')}</p>
      )}

      <div className="grid grid-cols-3 gap-2 px-3 sm:gap-4 sm:px-6">
        {analyticsCards.map(({ key, icon: Icon, accent, value, label }) => (
          <div
            key={key}
            className="flex flex-col items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-800/50 p-2 shadow-none sm:flex-row sm:items-center sm:gap-4 sm:rounded-xl sm:p-5 sm:shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:h-11 sm:w-11 sm:rounded-lg ${accent}`}
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="line-clamp-2 text-[9px] uppercase leading-tight tracking-wide text-slate-400 sm:line-clamp-none sm:text-xs">
                {label}
              </p>
              {invalidCustom ? (
                <p className="mt-0.5 text-lg font-bold tabular-nums text-white sm:mt-1 sm:text-2xl">—</p>
              ) : showSkeleton ? (
                <Skeleton className="mx-auto mt-0.5 h-5 w-9 bg-slate-700 sm:mx-0 sm:mt-1 sm:h-7 sm:w-12" />
              ) : (
                <p className="mt-0.5 text-lg font-bold tabular-nums text-white sm:mt-1 sm:text-2xl">{value}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
