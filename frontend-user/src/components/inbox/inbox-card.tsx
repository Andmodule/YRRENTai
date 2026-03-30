'use client';

import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ConversationDto } from '@/hooks/use-conversations';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';
import { formatGuestAndProperty, formatTelegramStyleTime } from '@/lib/format/conversation-meta';

interface InboxCardProps {
  conversation: ConversationDto;
  isActive: boolean;
  onClick: () => void;
}

export function InboxCard({ conversation, isActive, onClick }: InboxCardProps) {
  const locale = useLocale();
  const isUrgent = conversation.status === 'needs_human';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border border-[#dbeafe] p-3 transition-colors dark:border-indigo-900/45',
        isActive && 'bg-primary/5 ring-1 ring-[#dbeafe] dark:ring-indigo-900/45',
        !isActive && 'hover:bg-accent/50',
        isUrgent && !isActive && 'bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">
              {formatGuestAndProperty(conversation.externalGuestKey, conversation.propertyName)}
            </span>
            <ConversationStatusDot status={conversation.status} />
          </div>
          {conversation.lastMessagePreview && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {conversation.lastMessagePreview}
            </p>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {formatTelegramStyleTime(conversation.lastActivityAt, locale)}
        </span>
      </div>
    </button>
  );
}
