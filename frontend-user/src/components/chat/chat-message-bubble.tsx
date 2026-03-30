'use client';

import { Bot, User } from 'lucide-react';
import { useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { formatBubbleTimestamp } from '@/lib/format/conversation-meta';
import type { ChatMessage } from '@/hooks/use-chat';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const locale = useLocale();
  const isUser = message.role === 'user';
  const timeLabel = formatBubbleTimestamp(message.createdAt, locale);

  return (
    <div className={cn('flex gap-2 sm:gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'inline-flex min-w-0 max-w-[min(85%,32rem)] flex-col rounded-2xl px-3 pb-1.5 pt-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        <div className="min-w-0">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
        <div
          className={cn(
            'mt-1 flex shrink-0 justify-end self-end pl-4',
            isUser ? 'text-primary-foreground/65' : 'text-muted-foreground/90',
          )}
        >
          <time
            dateTime={message.createdAt}
            className="text-[11px] tabular-nums leading-none"
          >
            {timeLabel}
          </time>
        </div>
      </div>
    </div>
  );
}

interface StreamingBubbleProps {
  text: string;
}

export function StreamingBubble({ text }: StreamingBubbleProps) {
  return (
    <div className="flex gap-2 sm:gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="inline-flex min-w-0 max-w-[min(85%,32rem)] flex-col rounded-2xl bg-muted px-3 pb-1.5 pt-2 text-sm text-foreground">
        {text ? (
          <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
