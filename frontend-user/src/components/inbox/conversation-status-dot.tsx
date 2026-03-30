'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@rentai/shared/constants';

const STATUS_COLOR: Record<ConversationStatus, string> = {
  ai_handling: 'bg-blue-500',
  needs_human: 'bg-amber-500',
  resolved: 'bg-green-600',
};

export function ConversationStatusDot({
  status,
  className,
}: {
  status: ConversationStatus | string;
  className?: string;
}) {
  const t = useTranslations('inbox');
  const s = status as ConversationStatus;
  const label =
    s === 'needs_human'
      ? t('status.needs_human')
      : s === 'resolved'
        ? t('status.resolved')
        : t('status.ai_handling');

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-block size-[5px] shrink-0 rounded-full ring-1 ring-background',
        STATUS_COLOR[s] ?? STATUS_COLOR.ai_handling,
        className,
      )}
    />
  );
}
