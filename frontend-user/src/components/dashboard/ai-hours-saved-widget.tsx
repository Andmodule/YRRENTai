'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { parseISO } from 'date-fns';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

function seededUnit(i: number): number {
  const x = Math.sin(i * 12.9898) * 10000;
  return x - Math.floor(x);
}

function buildLast30DaysSeries(): { date: string; hours: number }[] {
  const days = 30;
  const raw: number[] = [];
  for (let i = 0; i < days; i++) {
    raw.push(1.5 + seededUnit(i + 7) * 6);
  }
  const target = 142;
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: { date: string; hours: number }[] = [];
  const end = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - (days - 1 - i));
    const iso = d.toISOString().slice(0, 10);
    const w = raw[i] ?? 0;
    const h = (target * w) / sum;
    out.push({ date: iso, hours: Math.round(h * 10) / 10 });
  }
  const drift = target - out.reduce((a, p) => a + p.hours, 0);
  if (Math.abs(drift) >= 0.05 && out.length > 0) {
    const idx = out.length - 1;
    const last = out[idx]!;
    out[idx] = {
      ...last,
      hours: Math.round((last.hours + drift) * 10) / 10,
    };
  }
  return out;
}

function useIsNarrowScreen() {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      const mq = window.matchMedia('(max-width: 639px)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined'
        ? window.matchMedia('(max-width: 639px)').matches
        : false,
    () => false,
  );
}

export function AiHoursSavedWidget() {
  const t = useTranslations('dashboard.aiHoursSaved');
  const locale = useLocale();
  const isNarrow = useIsNarrowScreen();
  const fillId = React.useId().replace(/:/g, '');

  const data = React.useMemo(() => buildLast30DaysSeries(), []);
  const totalHours = React.useMemo(
    () => Math.round(data.reduce((a, p) => a + p.hours, 0)),
    [data],
  );

  const chartConfig = React.useMemo(
    () =>
      ({
        hours: {
          label: t('seriesLabel'),
          color: '#6366f1',
        },
      }) satisfies ChartConfig,
    [t],
  );

  return (
    <section
      className={cn(
        'space-y-3 rounded-lg border border-border bg-card py-3 sm:space-y-4 sm:rounded-xl sm:py-6 dark:border-slate-800/80 dark:bg-slate-950/20',
      )}
    >
      <div className="px-3 sm:px-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:text-xs">
          {t('title')}
        </h2>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:mt-1 sm:text-sm">{t('subtitle')}</p>
      </div>

      <div className="relative px-3 sm:px-6">
        <p
          className="relative z-10 mb-1 text-3xl font-bold tabular-nums tracking-tight text-foreground sm:mb-2 sm:text-4xl dark:text-white"
          aria-live="polite"
        >
          {t('totalHours', { hours: totalHours })}
        </p>

        <ChartContainer
          config={chartConfig}
          className={cn('aspect-auto h-32 w-full sm:h-[200px]')}
        >
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-hours)" stopOpacity={0.45} />
                <stop offset="95%" stopColor="var(--color-hours)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              horizontal={false}
              vertical
              strokeDasharray="4 6"
              className="stroke-border dark:stroke-slate-600/35"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={isNarrow ? 48 : 28}
              tickFormatter={(value) => {
                const d = parseISO(String(value));
                return new Intl.DateTimeFormat(locale, {
                  month: 'short',
                  day: 'numeric',
                }).format(d);
              }}
              className="text-[10px] text-muted-foreground sm:text-xs"
            />
            <YAxis hide width={0} />
            <ChartTooltip
              cursor={{ stroke: 'rgba(99, 102, 241, 0.35)', strokeWidth: 1 }}
              content={(tooltipProps) => {
                const { content: _nested, ...rest } = tooltipProps;
                return (
                  <ChartTooltipContent
                    {...(rest as React.ComponentProps<typeof ChartTooltipContent>)}
                    hideIndicator
                    labelFormatter={(label) => {
                      try {
                        const d = parseISO(String(label));
                        if (Number.isNaN(d.getTime())) return String(label);
                        return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d);
                      } catch {
                        return String(label);
                      }
                    }}
                    formatter={(value) => (
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {Number(value).toLocaleString(locale, { maximumFractionDigits: 1 })} {t('hoursAbbr')}
                      </span>
                    )}
                  />
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="hours"
              stroke="var(--color-hours)"
              strokeWidth={2}
              fill={`url(#${fillId})`}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--color-hours)', stroke: 'var(--card)', strokeWidth: 1 }}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </section>
  );
}
