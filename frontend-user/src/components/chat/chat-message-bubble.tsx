'use client';

import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { formatBubbleTimestamp } from '@/lib/format/conversation-meta';
import type { ChatMessage } from '@/hooks/use-chat';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const locale = useLocale();
  const t = useTranslations('inbox');
  const isUser = message.role === 'user';
  const isStaffManual = message.role === 'assistant' && message.source === 'staff';
  const timeLabel = formatBubbleTimestamp(message.createdAt, locale);

  return (
    <div className={cn('flex w-full', isUser ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'inline-flex min-w-0 max-w-[min(85%,32rem)] flex-col px-3 pb-1.5 pt-2 text-sm',
          /* Гость слева, ответы (AI/оператор) справа */
          isUser
            ? 'rounded-2xl rounded-tl-md bg-primary text-primary-foreground dark:rounded-3xl dark:rounded-tl-lg dark:bg-zinc-800 dark:border dark:border-zinc-700 dark:text-white'
            : 'rounded-2xl rounded-tr-md bg-muted text-foreground dark:rounded-3xl dark:rounded-tr-lg dark:bg-slate-800/90 dark:border dark:border-slate-600/70 dark:text-slate-100',
        )}
      >
        {isStaffManual && (
          <span className="mb-1 block text-[11px] font-normal leading-snug text-muted-foreground/90 dark:text-slate-500">
            {t('operatorReplyBadge')}
          </span>
        )}
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
            isUser
              ? 'text-primary-foreground/70 dark:text-zinc-400'
              : 'text-muted-foreground/90 dark:text-slate-500',
          )}
        >
          <time dateTime={message.createdAt} className="text-[11px] tabular-nums leading-none">
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
    <div className="flex w-full justify-end">
      <div className="inline-flex min-w-0 max-w-[min(85%,32rem)] flex-col rounded-2xl rounded-tr-md bg-muted px-3 pb-1.5 pt-2 text-sm text-foreground dark:rounded-3xl dark:rounded-tr-lg dark:bg-slate-800/90 dark:border dark:border-slate-600/70 dark:text-slate-100">
        {text ? (
          <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-1 py-0.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
