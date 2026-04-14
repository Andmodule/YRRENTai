'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { AlertCircle, Check, Mail, MessageCircle, Send } from 'lucide-react';
import type { BookingComMessageMetadata } from '@rentai/shared';
import { stripEscalationForGuestDisplay } from '@rentai/shared';
import { cn } from '@/lib/utils';
import { formatBubbleTimestamp } from '@/lib/format/conversation-meta';
import type { ChatMessage, MessageChannelCode } from '@/hooks/use-chat';
import { EmailAttachmentChip } from '@/components/inbox/email-attachment-chip';
import { StaffOutboundAttachmentChip } from '@/components/inbox/staff-outbound-attachment-chip';
import { WhatsappInboundAttachmentChip } from '@/components/inbox/whatsapp-inbound-attachment-chip';
import { BookingComGuestMessage } from './booking-com-guest-message';

function bookingMetaForGuestBubble(
  metadata: ChatMessage['metadata'],
): BookingComMessageMetadata | null {
  if (!metadata) return null;
  if (metadata.channel === 'booking_com') return metadata;
  if (metadata.channel === 'email_inbound' && metadata.bookingCom) return metadata.bookingCom;
  return null;
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  /** Inbox: retry failed staff delivery (POST /chats/messages/:id/retry). */
  onRetryStaffDelivery?: (messageId: string) => Promise<void>;
}

function channelGlyph(ch: MessageChannelCode | undefined) {
  switch (ch) {
    case 'EMAIL':
      return <Mail className="h-2.5 w-2.5" aria-hidden />;
    case 'TELEGRAM':
      return <Send className="h-2.5 w-2.5" aria-hidden />;
    case 'WHATSAPP':
      return <MessageCircle className="h-2.5 w-2.5" aria-hidden />;
    default:
      return null;
  }
}

export function ChatMessageBubble({ message, onRetryStaffDelivery }: ChatMessageBubbleProps) {
  const locale = useLocale();
  const t = useTranslations('inbox');
  const isUser = message.role === 'user';
  const bookingMetaForUi = bookingMetaForGuestBubble(message.metadata);
  const emailAttachments =
    message.metadata?.channel === 'email_inbound' && message.metadata.attachments.length > 0
      ? message.metadata.attachments
      : null;
  const whatsappInboundMeta =
    isUser && message.metadata?.channel === 'whatsapp_inbound' ? message.metadata : null;
  const whatsappShowAttachment =
    whatsappInboundMeta &&
    ['image', 'audio', 'video', 'document', 'sticker'].includes(whatsappInboundMeta.waType);
  const isStaffManual = message.role === 'assistant' && message.source === 'staff';
  /** Всё, что не ручной ответ оператора (AI и legacy без `source`). */
  const isNonStaffAssistant = message.role === 'assistant' && !isStaffManual;
  const timeLabel = formatBubbleTimestamp(message.createdAt, locale);
  const displayContent = stripEscalationForGuestDisplay(message.content);
  const staffOutboundAttachments =
    !isUser &&
    isStaffManual &&
    message.metadata?.channel === 'staff_outbound' &&
    message.metadata.attachments.length > 0
      ? message.metadata.attachments
      : null;
  const hideSyntheticAttachedLine =
    !!staffOutboundAttachments &&
    /^Attached:\s/i.test(displayContent.trim()) &&
    !displayContent.includes('\n');
  const ds = message.deliveryStatus;
  /**
   * Staff: PENDING = нет иконки; SENT = галочка; ERROR = retry.
   * AI: нет внешней очереди как у staff — после сохранения в чат считаем доставленным (галочка при SENT / без PENDING).
   */
  const outboundDeliveryUi = isStaffManual
    ? ds === 'PENDING'
      ? null
      : ds === 'ERROR'
        ? 'error'
        : 'sent'
    : isNonStaffAssistant
      ? ds === 'PENDING'
        ? null
        : 'sent'
      : null;
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetryClick = async () => {
    if (!onRetryStaffDelivery || outboundDeliveryUi !== 'error' || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetryStaffDelivery(message.id);
    } finally {
      setIsRetrying(false);
    }
  };

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
          {isUser && bookingMetaForUi ? (
            <BookingComGuestMessage metadata={bookingMetaForUi} rawContent={displayContent} />
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{displayContent}</p>
          ) : (
            <>
              {!hideSyntheticAttachedLine && (
                <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown>{displayContent}</ReactMarkdown>
                </div>
              )}
              {staffOutboundAttachments && (
                <div
                  className={cn(
                    'flex flex-wrap gap-2',
                    !hideSyntheticAttachedLine && 'mt-2',
                  )}
                  role="group"
                  aria-label={t('attachmentsGroupAria', { count: staffOutboundAttachments.length })}
                >
                  {staffOutboundAttachments.map((att) => (
                    <StaffOutboundAttachmentChip key={att.id} messageId={message.id} attachment={att} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {isUser && emailAttachments && (
          <div
            className="mt-3 border-t border-primary-foreground/15 pt-3 dark:border-zinc-600/50"
            role="group"
            aria-label={t('attachmentsGroupAria', { count: emailAttachments.length })}
          >
            <div className="flex flex-wrap gap-2">
              {emailAttachments.map((att) => (
                <EmailAttachmentChip key={att.id} attachment={att} />
              ))}
            </div>
          </div>
        )}
        {isUser && whatsappShowAttachment && whatsappInboundMeta && (
          <div
            className="mt-3 border-t border-primary-foreground/15 pt-3 dark:border-zinc-600/50"
            role="group"
            aria-label={t('whatsappAttachmentGroupAria')}
          >
            <WhatsappInboundAttachmentChip messageId={message.id} meta={whatsappInboundMeta} />
          </div>
        )}
        <div
          className={cn(
            'mt-1 flex shrink-0 items-center justify-end gap-1.5 self-end pl-4',
            isUser
              ? 'text-primary-foreground/70 dark:text-zinc-400'
              : 'text-muted-foreground/90 dark:text-slate-500',
          )}
        >
          {isStaffManual && message.channel && channelGlyph(message.channel) && (
            <span
              className="inline-flex text-muted-foreground/80 dark:text-slate-500"
              title={t('messageChannelHint', { channel: message.channel })}
            >
              {channelGlyph(message.channel)}
            </span>
          )}
          <time dateTime={message.createdAt} className="text-[11px] tabular-nums leading-none">
            {timeLabel}
          </time>
          {outboundDeliveryUi && (
            <span className="inline-flex h-4 min-w-[14px] items-center justify-center">
              {outboundDeliveryUi === 'sent' && (
                <Check
                  className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400"
                  strokeWidth={2.75}
                  aria-hidden
                />
              )}
              {outboundDeliveryUi === 'error' && (
                <button
                  type="button"
                  onClick={() => void handleRetryClick()}
                  disabled={isRetrying}
                  className="inline-flex rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"
                  title={t('messageDeliveryRetry')}
                  aria-label={t('messageDeliveryRetry')}
                >
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface StreamingBubbleProps {
  text: string;
}

export function StreamingBubble({ text }: StreamingBubbleProps) {
  const displayText = stripEscalationForGuestDisplay(text);
  return (
    <div className="flex w-full justify-end">
      <div className="inline-flex min-w-0 max-w-[min(85%,32rem)] flex-col rounded-2xl rounded-tr-md bg-muted px-3 pb-1.5 pt-2 text-sm text-foreground dark:rounded-3xl dark:rounded-tr-lg dark:bg-slate-800/90 dark:border dark:border-slate-600/70 dark:text-slate-100">
        {displayText ? (
          <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{displayText}</ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-1.5 py-0.5" aria-hidden>
            <div className="h-3 w-32 max-w-full animate-pulse rounded-md bg-muted-foreground/35 dark:bg-slate-500/45" />
            <div className="h-3 w-20 max-w-full animate-pulse rounded-md bg-muted-foreground/25 dark:bg-slate-500/35" />
          </div>
        )}
      </div>
    </div>
  );
}
