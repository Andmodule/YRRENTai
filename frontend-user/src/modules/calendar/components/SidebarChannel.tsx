'use client';

import { memo } from 'react';
import type { Channel } from 'planby';
import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ZodomusStatusBadge } from '@/components/property/zodomus-status-badge';
import type { ZodomusPropertyStatus } from '@rentai/shared';
import type { Property } from '../types';

interface SidebarChannelProps {
  channel: Channel;
  meta: string;
  isMobile: boolean;
}

function isZodomusStatus(v: unknown): v is ZodomusPropertyStatus {
  return (
    typeof v === 'string' &&
    ['active', 'evaluation', 'not_active', 'invalid', 'error', 'unknown'].includes(v)
  );
}

/** Row height is fixed by Planby (64px); keep content single column, tight leading, no extra vertical padding. */
export const SidebarChannel = memo(function SidebarChannel({ channel, meta, isMobile }: SidebarChannelProps) {
  const t = useTranslations('calendar');
  const property = (channel as Channel & { _property?: Property })._property;
  const title = property?.title ?? '';
  const logo = channel.logo;
  const avatarSrc = logo;
  const linked = Boolean(property?.zodomusLinked || property?.zodomusPropertyId?.trim());
  const status = isZodomusStatus(property?.zodomusStatus) ? property.zodomusStatus : null;
  const showStatusBadge = linked && status != null && status !== 'active';
  const ariUnavailable = Boolean(linked && property?.ariUnavailable);

  return (
    <div
      className={cn(
        'box-border flex h-full max-h-full min-h-0 w-full items-center gap-2 overflow-hidden px-2',
        'text-foreground transition-colors hover:bg-muted/50',
        isMobile ? 'justify-center px-1' : '',
      )}
      aria-label={isMobile ? title : undefined}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          className={cn(
            'shrink-0 rounded object-cover',
            isMobile ? 'h-11 w-11' : 'h-8 w-8',
          )}
        />
      ) : (
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground',
            isMobile ? 'h-11 w-11' : 'h-8 w-8',
          )}
        >
          <Building2 className="h-4 w-4" aria-hidden />
        </div>
      )}
      {!isMobile && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden leading-none">
          <p className="flex min-w-0 items-center gap-1">
            <span className="truncate text-xs font-medium leading-tight">{title}</span>
            {linked ? (
              <span
                className="shrink-0 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary"
                title={t('propertyOtaBadgeTitle')}
              >
                OTA
              </span>
            ) : null}
            {showStatusBadge ? (
              <ZodomusStatusBadge
                status={status}
                detail={property?.zodomusStatusDetail}
                linked
                className="shrink-0"
              />
            ) : null}
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {ariUnavailable ? t('ariUnavailableHint') : meta}
          </p>
        </div>
      )}
      {isMobile && (
        <span className="sr-only">
          {title} — {ariUnavailable ? t('ariUnavailableHint') : meta}
          {showStatusBadge && status ? ` — ${status}` : ''}
        </span>
      )}
    </div>
  );
});
