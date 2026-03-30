'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  endOfDay,
  format,
  parse,
  startOfDay,
  startOfYear,
  subDays,
} from 'date-fns';
import { Bot, Percent, UserRound } from 'lucide-react';
import { useReplyAnalytics } from '@/hooks/use-reply-analytics';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

type Preset = 'last30' | 'yearStart' | 'custom';

export function ReplyAnalyticsSection() {
  const t = useTranslations('dashboard.analytics');
  const [preset, setPreset] = useState<Preset>('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo((): { from: Date; to: Date } | null => {
    const now = new Date();
    if (preset === 'last30') {
      return { from: subDays(now, 30), to: now };
    }
    if (preset === 'yearStart') {
      return { from: startOfYear(now), to: now };
    }
    if (preset === 'custom' && customFrom && customTo) {
      const from = startOfDay(parse(customFrom, 'yyyy-MM-dd', new Date()));
      const to = endOfDay(parse(customTo, 'yyyy-MM-dd', new Date()));
      if (from.getTime() > to.getTime()) return null;
      return { from, to };
    }
    return null;
  }, [preset, customFrom, customTo]);

  const { data, isLoading, isValidating } = useReplyAnalytics(range);

  function onPresetChange(value: string) {
    const next = value as Preset;
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
    !invalidCustom &&
    (incompleteCustom || (range != null && (isLoading || isValidating)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
          <Label htmlFor="analytics-period" className="text-xs text-muted-foreground">
            {t('periodLabel')}
          </Label>
          <Select
            id="analytics-period"
            value={preset}
            onChange={(e) => onPresetChange(e.target.value)}
          >
            <option value="last30">{t('periodLast30')}</option>
            <option value="yearStart">{t('periodYearStart')}</option>
            <option value="custom">{t('periodCustom')}</option>
          </Select>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="analytics-from" className="text-xs text-muted-foreground">
              {t('customFrom')}
            </Label>
            <Input
              id="analytics-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="analytics-to" className="text-xs text-muted-foreground">
              {t('customTo')}
            </Label>
            <Input
              id="analytics-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </div>
      )}

      {invalidCustom ? (
        <p className="text-sm text-destructive">{t('invalidRange')}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg text-blue-600 bg-blue-50">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{t('aiReplies')}</p>
            {invalidCustom ? (
              <p className="mt-1 text-2xl font-semibold">—</p>
            ) : showSkeleton ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{data?.ai ?? 0}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg text-amber-700 bg-amber-50">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{t('manualReplies')}</p>
            {invalidCustom ? (
              <p className="mt-1 text-2xl font-semibold">—</p>
            ) : showSkeleton ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{data?.staff ?? 0}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg text-violet-600 bg-violet-50">
            <Percent className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{t('aiShare')}</p>
            {invalidCustom ? (
              <p className="mt-1 text-2xl font-semibold">—</p>
            ) : showSkeleton ? (
              <Skeleton className="mt-1 h-8 w-14" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">
                {data?.aiPercent == null ? '—' : `${data.aiPercent}%`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
