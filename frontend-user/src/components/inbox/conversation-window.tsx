'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Send, MessageSquare } from 'lucide-react';
import { useChat } from '@/hooks/use-chat';
import { ChatMessageBubble, StreamingBubble } from '@/components/chat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConversationDto } from '@/hooks/use-conversations';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';
import { formatGuestAndProperty, formatTelegramStyleTime } from '@/lib/format/conversation-meta';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';
import { apiClient } from '@/lib/api/client';

interface ConversationWindowProps {
  conversation: ConversationDto;
}

export function ConversationWindow({ conversation }: ConversationWindowProps) {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const { messages, streamingText, isStreaming, isConnected, error } = useChat(
    conversation.propertyId,
    { conversationId: conversation.id },
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleStaffReply = useCallback(async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    try {
      await apiClient.post('/chats/conversations/reply', {
        conversationId: conversation.id,
        content: replyText.trim(),
      });
      setReplyText('');
    } finally {
      setReplying(false);
    }
  }, [replyText, replying, conversation.id]);

  const isNeedsHuman = conversation.status === 'needs_human';

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className={cn('hidden w-full min-w-0 items-center gap-3 px-4 py-3 lg:flex', CHAT_FRAME.b)}>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-normal text-foreground">
              {formatGuestAndProperty(conversation.externalGuestKey, conversation.propertyName)}
            </span>
            <ConversationStatusDot status={conversation.status} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTelegramStyleTime(conversation.lastActivityAt, locale)}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 w-full min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 py-4 max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))]"
      >
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t('noMessages')}</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && <StreamingBubble text={streamingText} />}
      </div>

      {error && (
        <div className={cn(CHAT_FRAME.t, 'bg-destructive/10 px-4 py-2 text-xs text-destructive')}>
          {error}
        </div>
      )}

      <div
        className={cn(
          CHAT_FRAME.t,
          'shrink-0 bg-background p-3',
          'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          'lg:relative lg:inset-auto lg:z-auto',
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleStaffReply();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleStaffReply();
              }
            }}
            placeholder={isNeedsHuman ? t('replyPlaceholderUrgent') : t('replyPlaceholder')}
            disabled={replying || !isConnected}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-lg border bg-background px-4 py-3 text-sm ring-offset-background',
              'border-[#dbeafe] dark:border-indigo-900/45',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 dark:focus-visible:ring-sky-600/50',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isNeedsHuman && 'border-amber-400 focus-visible:ring-amber-400 dark:border-amber-600',
            )}
            style={{ minHeight: 48, maxHeight: 120 }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = '48px';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <Button
            type="submit"
            disabled={replying || !replyText.trim() || !isConnected}
            size="icon"
            className={cn('h-12 w-12 shrink-0', isNeedsHuman && 'bg-amber-500 hover:bg-amber-600')}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
