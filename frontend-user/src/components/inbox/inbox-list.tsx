'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import type { ConversationDto } from '@/hooks/use-conversations';
import { formatGuestAndProperty } from '@/lib/format/conversation-meta';
import { useInboxSearchStore } from '@/stores/inbox-search.store';
import { InboxCard } from './inbox-card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

function conversationMatchesQuery(c: ConversationDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const title = formatGuestAndProperty(c.externalGuestKey, c.propertyName, c.guestDisplayName);
  const hay = [
    title,
    c.propertyName ?? '',
    c.guestDisplayName ?? '',
    c.externalGuestKey ?? '',
    c.lastMessagePreview ?? '',
    c.channel ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

interface InboxListProps {
  conversations: ConversationDto[];
  isLoading: boolean;
  activeId: string | null;
  onSelect: (conv: ConversationDto) => void;
}

export function InboxList({ conversations, isLoading, activeId, onSelect }: InboxListProps) {
  const t = useTranslations('inbox');
  const searchQuery = useInboxSearchStore((s) => s.query);

  const filtered = useMemo(
    () => conversations.filter((c) => conversationMatchesQuery(c, searchQuery)),
    [conversations, searchQuery],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10" />}
        title={t('empty')}
        description={t('emptyHint')}
        className="py-16"
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10" />}
        title={t('searchNoResults')}
        description={t('searchNoResultsHint')}
        className="py-16"
      />
    );
  }

  return (
    <div className="space-y-1 p-2 overflow-y-auto">
      {filtered.map((conv) => (
        <InboxCard
          key={conv.id}
          conversation={conv}
          isActive={activeId != null && conv.id.toLowerCase() === activeId.toLowerCase()}
          onClick={() => onSelect(conv)}
        />
      ))}
    </div>
  );
}
