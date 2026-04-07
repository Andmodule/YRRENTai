'use client';

import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ConversationDto } from '@/hooks/use-conversations';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';
import { formatGuestAndProperty, formatTelegramStyleTime } from '@/lib/format/conversation-meta';
import { TruncatedTooltipText } from '@/components/inbox/truncated-tooltip-text';
import { ConversationChannelBadge } from '@/components/inbox/conversation-channel-badge';

interface InboxCardProps {
  conversation: ConversationDto;
  isActive: boolean;
  onClick: () => void;
}

export function InboxCard({ conversation, isActive, onClick }: InboxCardProps) {
  const locale = useLocale();
  const isUrgent = conversation.status === 'needs_human';
  const titleLine = formatGuestAndProperty(
    conversation.externalGuestKey,
    conversation.propertyName,
    conversation.guestDisplayName,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border p-3 transition-colors',
        isActive
          ? 'bg-primary/15 border-primary/30 ring-1 ring-primary/20'
          : 'border-slate-200 hover:bg-slate-50 hover:border-slate-300 dark:border-slate-700/80 dark:hover:bg-slate-800/80 dark:hover:border-slate-600',
        isUrgent &&
          !isActive &&
          'border-amber-400/60 bg-amber-50/80 hover:bg-amber-100/80 dark:border-amber-500/30 dark:bg-amber-950/20 dark:hover:bg-amber-900/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TruncatedTooltipText
              text={titleLine}
              className="min-w-0 flex-1 text-sm font-normal text-foreground dark:text-slate-200"
            />
            <ConversationChannelBadge channel={conversation.channel} />
            <ConversationStatusDot status={conversation.status} />
          </div>
          {conversation.lastMessagePreview && (
            <p className="mt-1 truncate text-xs text-muted-foreground dark:text-slate-500">
              {conversation.lastMessagePreview}
            </p>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground dark:text-slate-500">
          {formatTelegramStyleTime(conversation.lastActivityAt, locale)}
        </span>
      </div>
    </button>
  );
}
