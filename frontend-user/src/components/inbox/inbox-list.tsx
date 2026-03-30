'use client';

import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { useConversations, type ConversationDto } from '@/hooks/use-conversations';
import { InboxCard } from './inbox-card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

interface InboxListProps {
  activeId: string | null;
  onSelect: (conv: ConversationDto) => void;
}

export function InboxList({ activeId, onSelect }: InboxListProps) {
  const t = useTranslations('inbox');
  const { conversations, isLoading } = useConversations({
    limit: 50,
  });

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

  return (
    <div className="space-y-1 p-2 overflow-y-auto">
      {conversations.map((conv) => (
        <InboxCard
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeId}
          onClick={() => onSelect(conv)}
        />
      ))}
    </div>
  );
}
