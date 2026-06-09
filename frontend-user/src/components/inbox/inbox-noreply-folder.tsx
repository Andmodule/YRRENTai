'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Folder } from 'lucide-react';
import type { ConversationDto } from '@/hooks/use-conversations';
import { isNoreplyInboxConversation } from '@/lib/format/conversation-meta';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { InboxCard } from './inbox-card';

interface InboxNoreplyFolderProps {
  conversations: ConversationDto[];
  activeId: string | null;
  onSelect: (conv: ConversationDto) => void;
}

export function InboxNoreplyFolder({
  conversations,
  activeId,
  onSelect,
}: InboxNoreplyFolderProps) {
  const t = useTranslations('inbox');
  const [open, setOpen] = useState(false);

  const activeInFolder =
    activeId != null &&
    conversations.some((c) => c.id.toLowerCase() === activeId.toLowerCase());

  useEffect(() => {
    if (activeInFolder) setOpen(true);
  }, [activeInFolder]);

  if (conversations.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <CollapsibleTrigger
        type="button"
        aria-label={t('noreplyFolderToggleAria', { count: conversations.length })}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors',
          'text-muted-foreground hover:bg-slate-100/80 hover:text-foreground/80',
          'dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-300',
          open && 'bg-slate-50/80 dark:bg-slate-800/40',
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 opacity-50 transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <Folder className="size-3.5 shrink-0 opacity-45" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-normal">{t('noreplyFolderTitle')}</span>
        <span className="shrink-0 tabular-nums text-[11px] opacity-60">{conversations.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pt-1 pl-1">
        {conversations.map((conv) => (
          <InboxCard
            key={conv.id}
            conversation={conv}
            isActive={activeId != null && conv.id.toLowerCase() === activeId.toLowerCase()}
            onClick={() => onSelect(conv)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function partitionInboxConversations(conversations: ConversationDto[]): {
  guest: ConversationDto[];
  noreply: ConversationDto[];
} {
  const guest: ConversationDto[] = [];
  const noreply: ConversationDto[] = [];
  for (const c of conversations) {
    if (isNoreplyInboxConversation(c.externalGuestKey)) {
      noreply.push(c);
    } else {
      guest.push(c);
    }
  }
  return { guest, noreply };
}
