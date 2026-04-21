'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, Send, MessageSquare, X } from 'lucide-react';
import { useChat } from '@/hooks/use-chat';
import { ChatMessageBubble, StreamingBubble } from '@/components/chat';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ConversationDto } from '@/hooks/use-conversations';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';
import { ConversationChannelBadge } from '@/components/inbox/conversation-channel-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatGuestAndProperty } from '@/lib/format/conversation-meta';
import { TruncatedTooltipText } from '@/components/inbox/truncated-tooltip-text';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';
import { apiClient } from '@/lib/api/client';
import { formatBytes } from '@/lib/utils/format-bytes';

interface StaffReplyAttachmentPayload {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}

interface ConversationWindowProps {
  conversation: ConversationDto;
  /** Вызывается после успешного POST /chats/conversations/reply — обновить список без ожидания WS. */
  onStaffReplySuccess?: (conversationId: string, content: string) => void;
}

export function ConversationWindow({ conversation, onStaffReplySuccess }: ConversationWindowProps) {
  const t = useTranslations('inbox');
  const { messages, isHistoryLoading, streamingText, isStreaming, isConnected, error } = useChat(
    conversation.propertyId,
    { conversationId: conversation.id },
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<StaffReplyAttachmentPayload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const uploadStaffFile = useCallback(
    async (file: File): Promise<StaffReplyAttachmentPayload> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiClient.post<{ data: StaffReplyAttachmentPayload }>(
        `/chats/conversations/${encodeURIComponent(conversation.id)}/staff-attachments`,
        fd,
      );
      return res.data.data;
    },
    [conversation.id],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      setAttachError(null);
      for (const file of Array.from(files)) {
        setUploadingCount((c) => c + 1);
        try {
          const att = await uploadStaffFile(file);
          setPendingAttachments((prev) => [...prev, att]);
        } catch {
          setAttachError(t('attachUploadError'));
        } finally {
          setUploadingCount((c) => Math.max(0, c - 1));
        }
      }
      e.target.value = '';
    },
    [uploadStaffFile, t],
  );

  const handleStaffReply = useCallback(async () => {
    const canSend =
      (replyText.trim().length > 0 || pendingAttachments.length > 0) && !replying && uploadingCount === 0;
    if (!canSend) return;
    setReplying(true);
    setAttachError(null);
    try {
      const content = replyText.trim();
      await apiClient.post('/chats/conversations/reply', {
        conversationId: conversation.id,
        content,
        ...(pendingAttachments.length ? { attachments: pendingAttachments } : {}),
      });
      onStaffReplySuccess?.(conversation.id, content || pendingAttachments.map((a) => a.fileName).join(', '));
      setReplyText('');
      setPendingAttachments([]);
    } finally {
      setReplying(false);
    }
  }, [
    replyText,
    pendingAttachments,
    replying,
    uploadingCount,
    conversation.id,
    onStaffReplySuccess,
  ]);

  const handleRetryStaffDelivery = useCallback(async (messageId: string) => {
    await apiClient.post(`/chats/messages/${encodeURIComponent(messageId)}/retry`);
  }, []);

  const isNeedsHuman = conversation.status === 'needs_human';
  const headerTitle = formatGuestAndProperty(
    conversation.externalGuestKey,
    conversation.propertyName,
    conversation.guestDisplayName,
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className={cn('hidden w-full min-w-0 items-center gap-3 px-4 py-3 lg:flex', CHAT_FRAME.b)}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TruncatedTooltipText
            text={headerTitle}
            className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
          />
          <ConversationChannelBadge channel={conversation.channel} />
          <ConversationStatusDot status={conversation.status} />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 w-full min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain touch-pan-y [-webkit-overflow-scrolling:touch] bg-slate-50 px-4 py-4 max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] dark:bg-slate-900/50"
      >
        {conversation.channel === 'whatsapp' && (
          <Alert className="border-emerald-500/25 bg-emerald-500/5 text-foreground dark:bg-emerald-950/20 dark:border-emerald-500/20">
            <AlertDescription className="space-y-2 text-xs leading-relaxed text-muted-foreground dark:text-slate-300">
              <p className="font-medium text-foreground dark:text-slate-100">{t('whatsappPolicyTitle')}</p>
              <p>{t('whatsappPolicyBody')}</p>
            </AlertDescription>
          </Alert>
        )}
        {isHistoryLoading && (
          <div className="space-y-4 py-2" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-end' : 'justify-start')}>
                <Skeleton className={cn('h-16 rounded-2xl', i % 2 === 0 ? 'w-[min(100%,280px)]' : 'w-[min(100%,320px)]')} />
              </div>
            ))}
          </div>
        )}
        {!isHistoryLoading && messages.length === 0 && !isStreaming && (
          <div className="flex min-h-[min(280px,45dvh)] flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t('noMessages')}</p>
          </div>
        )}
        {!isHistoryLoading &&
          messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              onRetryStaffDelivery={handleRetryStaffDelivery}
            />
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
          'shrink-0 bg-background/95 backdrop-blur-sm p-3 dark:bg-slate-900/90',
          'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          'lg:relative lg:inset-auto lg:z-auto',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void handleFileInputChange(e)}
        />
        {attachError && (
          <div className="mb-2 text-xs text-destructive" role="alert">
            {attachError}
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2" aria-live="polite">
            {pendingAttachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-xs text-foreground"
              >
                <span className="truncate">{a.fileName}</span>
                <span className="shrink-0 text-muted-foreground">({formatBytes(a.sizeBytes)})</span>
                <button
                  type="button"
                  onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={t('removePendingFileAria', { name: a.fileName })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
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
                if (
                  (replyText.trim() || pendingAttachments.length > 0) &&
                  !replying &&
                  uploadingCount === 0
                ) {
                  void handleStaffReply();
                }
              }
            }}
            placeholder={isNeedsHuman ? t('replyPlaceholderUrgent') : t('replyPlaceholder')}
            disabled={replying || !isConnected || uploadingCount > 0}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-lg border px-4 py-3 text-sm',
              'border-input bg-input-fill text-foreground placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus-visible:ring-cyan-500/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isNeedsHuman &&
                'border-amber-400 focus-visible:ring-amber-400 dark:border-amber-500/50 dark:focus-visible:ring-amber-500/40',
            )}
            style={{ minHeight: 48, maxHeight: 120 }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = '48px';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={replying || !isConnected || uploadingCount > 0}
            className={cn(
              'h-12 w-12 shrink-0 rounded-lg border border-transparent p-0',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              'dark:hover:bg-slate-800 dark:hover:text-slate-200',
            )}
            aria-label={t('attachFileAria')}
            title={t('attachFileAria')}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            variant="ghost"
            disabled={
              replying ||
              (!replyText.trim() && pendingAttachments.length === 0) ||
              !isConnected ||
              uploadingCount > 0
            }
            size="icon"
            className={cn(
              'h-12 w-12 shrink-0 rounded-lg border border-transparent p-0',
              'bg-muted text-primary hover:border-primary/25 hover:bg-primary/10 hover:text-primary',
              'dark:bg-[#0d1421] dark:text-[#00d4ff] dark:hover:border-[#00d4ff]/20 dark:hover:bg-[#00d4ff]/10',
              isNeedsHuman &&
                'text-amber-600 hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:border-amber-500/25 dark:hover:bg-amber-500/10 dark:hover:text-amber-300',
            )}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
