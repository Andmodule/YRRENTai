'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { Check, Loader2, Pencil, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/client';
import { formatBubbleTimestamp } from '@/lib/format/conversation-meta';
import type { ChatMessage } from '@/hooks/use-chat';

interface AiDraftMessageBubbleProps {
  message: ChatMessage;
  onResolved?: () => void;
}

export function AiDraftMessageBubble({ message, onResolved }: AiDraftMessageBubbleProps) {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(message.content);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const timeLabel = formatBubbleTimestamp(message.createdAt, locale);

  async function handleApprove() {
    setBusy('approve');
    try {
      await apiClient.post(`/chats/messages/${encodeURIComponent(message.id)}/ai-draft/approve`, {
        ...(editing ? { content: draftText.trim() } : {}),
      });
      onResolved?.();
    } finally {
      setBusy(null);
      setEditing(false);
    }
  }

  async function handleReject() {
    setBusy('reject');
    try {
      await apiClient.post(`/chats/messages/${encodeURIComponent(message.id)}/ai-draft/reject`);
      setRejectOpen(false);
      onResolved?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex w-full justify-end">
        <div
          className={cn(
            'relative inline-flex min-w-0 max-w-[min(92%,36rem)] flex-col overflow-hidden rounded-2xl rounded-tr-md',
            'border border-amber-200/90 bg-gradient-to-br from-amber-50 via-amber-50/80 to-orange-50/60',
            'text-sm text-foreground shadow-sm',
            'dark:border-amber-700/40 dark:from-amber-950/50 dark:via-amber-950/35 dark:to-orange-950/20 dark:text-slate-100',
          )}
        >
          <div
            className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-amber-400/90 dark:bg-amber-500/80"
            aria-hidden
          />

          <div className="flex items-start gap-2.5 px-3.5 pb-2 pt-3 pl-4">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-snug text-amber-950 dark:text-amber-100">
                {t('aiDraftBadge')}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-amber-800/75 dark:text-amber-200/70">
                {t('aiDraftHint')}
              </p>
            </div>
            <time
              dateTime={message.createdAt}
              className="shrink-0 text-[11px] tabular-nums text-amber-800/55 dark:text-amber-300/50"
            >
              {timeLabel}
            </time>
          </div>

          <div className="px-3.5 pb-3 pl-4">
            {editing ? (
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={5}
                className="min-h-[5rem] resize-y border-amber-200/80 bg-white/80 text-sm dark:border-amber-800/50 dark:bg-slate-900/50"
                disabled={busy !== null}
                aria-label={t('aiDraftEdit')}
              />
            ) : (
              <div className="prose prose-sm max-w-none rounded-lg bg-white/50 px-2.5 py-2 dark:prose-invert dark:bg-slate-900/30 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-amber-200/70 bg-amber-100/30 px-3.5 py-2.5 pl-4 dark:border-amber-800/40 dark:bg-amber-950/25">
            {editing ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={busy !== null || !draftText.trim()}
                  onClick={() => void handleApprove()}
                >
                  {busy === 'approve' ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {t('aiDraftSaveAndApprove')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setEditing(false);
                    setDraftText(message.content);
                  }}
                >
                  {t('aiDraftCancelEdit')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={busy !== null}
                  onClick={() => void handleApprove()}
                >
                  {busy === 'approve' ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {t('aiDraftApprove')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-300/80 bg-white/60 hover:bg-white dark:border-amber-700/50 dark:bg-slate-900/40"
                  disabled={busy !== null}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t('aiDraftEdit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => setRejectOpen(true)}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t('aiDraftReject')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          title={t('aiDraftRejectTitle')}
          description={t('aiDraftRejectDescription')}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy === 'reject'}
                onClick={() => setRejectOpen(false)}
              >
                {t('aiDraftCancelEdit')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy === 'reject'}
                onClick={() => void handleReject()}
              >
                {busy === 'reject' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {t('aiDraftReject')}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">{t('aiDraftRejectConfirm')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
