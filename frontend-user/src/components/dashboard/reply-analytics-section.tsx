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
    <section className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/20 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {t('title')}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{t('subtitle')}</p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <div
            className="inline-flex rounded-md border border-slate-700/80 bg-slate-900/40 p-0.5"
            role="group"
            aria-label={t('ariaPeriod')}
          >
            <button
              type="button"
              onClick={() => selectPreset('last30')}
              className={cn(
                'rounded px-2.5 py-1.5 text-xs tabular-nums transition-colors',
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
                'rounded px-2.5 py-1.5 text-xs transition-colors',
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
        <p className="text-xs text-destructive">{t('invalidRange')}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {analyticsCards.map(({ key, icon: Icon, accent, value, label }) => (
          <div
            key={key}
            className="flex items-center gap-4 rounded-xl border border-slate-700/80 bg-slate-800/50 p-5 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
              {invalidCustom ? (
                <p className="mt-1 text-2xl font-bold text-white">—</p>
              ) : showSkeleton ? (
                <Skeleton className="mt-1 h-7 w-12 bg-slate-700" />
              ) : (
                <p className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
