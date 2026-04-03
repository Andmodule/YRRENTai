'use client';

import { useTranslations } from 'next-intl';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ZodomusPropertyPreview } from '@/hooks/use-zodomus-property-preview';

export function ZodomusRoomRatesPanel({
  rooms,
  className,
}: {
  rooms: ZodomusPropertyPreview['rooms'];
  className?: string;
}) {
  const t = useTranslations('properties.form');

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-xs font-semibold text-foreground">{t('previewRoomRatesTitle')}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:text-[12px]">
            {t('previewRoomRatesIntro')}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="overflow-hidden rounded-xl border border-border/50 bg-background/50 shadow-sm"
          >
            <div className="border-b border-border/40 bg-muted/25 px-3 py-2 sm:px-4">
              <p className="text-sm font-medium text-foreground">{room.name?.trim() || room.id}</p>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{room.id}</p>
            </div>
            {room.rates && room.rates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[280px] border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/15 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                      <th className="px-3 py-2 font-medium sm:px-4">{t('previewRateColRate')}</th>
                      <th className="px-3 py-2 font-medium sm:px-4">{t('previewRateColId')}</th>
                      <th className="px-3 py-2 font-medium sm:px-4">{t('previewRateColGuests')}</th>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell sm:px-4">
                        {t('previewRateColActive')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {room.rates.map((rate) => (
                      <tr
                        key={`${room.id}-${rate.id}`}
                        className="border-b border-border/30 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-3 py-2 font-medium text-foreground sm:px-4">
                          {rate.name?.trim() || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground sm:px-4">
                          {rate.id}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground sm:px-4">
                          {rate.maxPersons ?? '—'}
                        </td>
                        <td className="hidden px-3 py-2 sm:table-cell sm:px-4">
                          {rate.active != null && rate.active !== '' ? rate.active : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-3 py-3 text-[11px] text-muted-foreground sm:px-4 sm:text-xs">—</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground/90 sm:text-[12px]">
        {t('previewRoomRatesFootnote')}
      </p>
    </div>
  );
}
