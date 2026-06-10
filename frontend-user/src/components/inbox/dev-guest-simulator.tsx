'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, ChevronDown, FlaskConical, Loader2, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { ChatInput } from '@/components/chat/chat-input';
import { connectChatSocket, getChatSocket } from '@/lib/socket/client';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { emailLikeFromExternalGuestKey } from '@/lib/format/conversation-meta';
import type { Property } from '@/types';
import type { ConversationDto } from '@/hooks/use-conversations';

interface DevGuestSimulatorProps {
  properties: Property[];
  syncedPropertyId?: string | null;
  /** Open conversation — enables “guest question in this thread” below. */
  activeConversation?: ConversationDto | null;
  /** After deleting the open conversation — refresh inbox and clear selection. */
  onChatsCleared?: () => void;
  /** Refetch inbox list (dev send may miss `conversation:updated` before inbox subscribe). */
  onInboxRefresh?: () => void;
  /** Open the thread created/updated by a new-guest send. */
  onOpenConversation?: (conversationId: string) => void;
  className?: string;
}

/**
 * Dev-only: collapsed by default. New guest threads + guest messages in the selected inbox row.
 */
export function DevGuestSimulator({
  properties,
  syncedPropertyId,
  activeConversation,
  onChatsCleared,
  onInboxRefresh,
  onOpenConversation,
  className,
}: DevGuestSimulatorProps) {
  const t = useTranslations('inbox');
  const [expanded, setExpanded] = useState(false);
  const [guestKey, setGuestKey] = useState('guest-a');
  const [sendingNew, setSendingNew] = useState(false);
  const [sendingOpen, setSendingOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [propertyId, setPropertyId] = useState('');

  useEffect(() => {
    if (properties.length === 0) return;
    setPropertyId((prev) => {
      if (prev && properties.some((p) => p.id === prev)) return prev;
      if (syncedPropertyId && properties.some((p) => p.id === syncedPropertyId)) {
        return syncedPropertyId;
      }
      return properties[0]!.id;
    });
  }, [properties, syncedPropertyId]);

  async function emitGuestMessage(
    payload: { propertyId: string; content: string; conversationId?: string; guestSessionKey?: string },
    opts?: { openConversationOnSave?: boolean },
  ): Promise<boolean> {
    await connectChatSocket();
    const s = getChatSocket();
    if (!s?.connected) {
      toast.error(t('dev.socketNotConnected'));
      return false;
    }

    let detachSaved: (() => void) | undefined;
    if (opts?.openConversationOnSave) {
      const onSaved = (msg: { propertyId?: string; conversationId?: string }) => {
        if (msg.propertyId !== payload.propertyId || !msg.conversationId) return;
        detachSaved?.();
        onInboxRefresh?.();
        onOpenConversation?.(msg.conversationId);
      };
      s.on('message:saved', onSaved);
      detachSaved = () => s.off('message:saved', onSaved);
      window.setTimeout(() => detachSaved?.(), 15_000);
    }

    s.emit('message:send', payload);
    onInboxRefresh?.();
    return true;
  }

  async function handleSendNewThread(content: string) {
    if (!propertyId) return;
    const key = guestKey.trim() || 'default';
    setSendingNew(true);
    try {
      await emitGuestMessage(
        {
          propertyId,
          content: content.trim(),
          guestSessionKey: key,
        },
        { openConversationOnSave: true },
      );
    } finally {
      setSendingNew(false);
    }
  }

  async function handleSendInOpenConversation(content: string) {
    if (!activeConversation) return;
    setSendingOpen(true);
    try {
      await emitGuestMessage({
        propertyId: activeConversation.propertyId,
        conversationId: activeConversation.id,
        content: content.trim(),
      });
    } finally {
      setSendingOpen(false);
    }
  }

  async function handleClearOpenConversation() {
    if (!activeConversation) return;
    if (!window.confirm(t('dev.clearConversationConfirm'))) return;
    setClearing(true);
    try {
      await apiClient.post(
        `/chats/dev/conversations/${encodeURIComponent(activeConversation.id)}/clear`,
      );
      toast.success(t('dev.clearConversationSuccess'));
      onChatsCleared?.();
    } catch {
      toast.error(t('dev.clearConversationError'));
    } finally {
      setClearing(false);
    }
  }

  if (properties.length === 0) return null;

  const openThreadLabel = activeConversation
    ? `${activeConversation.propertyName}${
        activeConversation.externalGuestKey
          ? ` · ${emailLikeFromExternalGuestKey(activeConversation.externalGuestKey)}`
          : ''
      }`
    : null;

  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-amber-300/70 bg-amber-50/35 dark:border-amber-700/45 dark:bg-amber-950/15',
        className,
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-amber-900 dark:text-amber-100"
        >
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('dev.panelSummary')}</span>
        </button>

        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={clearing || !activeConversation}
              aria-label={t('dev.clearConversationIconAria')}
              title={
                activeConversation ? t('dev.clearConversation') : t('dev.clearConversationDisabled')
              }
              className={cn(
                'h-7 w-7 shrink-0 rounded text-amber-900 hover:bg-amber-500/20 dark:text-amber-100',
                !activeConversation && 'opacity-40',
              )}
              onClick={() => void handleClearOpenConversation()}
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            <p className="font-medium">{t('dev.clearConversation')}</p>
            <p className="mt-0.5 text-muted-foreground">
              {activeConversation ? t('dev.clearConversationTooltip') : t('dev.clearConversationDisabled')}
            </p>
          </TooltipContent>
        </Tooltip>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-amber-900 dark:text-amber-100"
          aria-label={expanded ? t('dev.collapsePanel') : t('dev.expandPanel')}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden
          />
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-amber-200/50 px-2 pb-2 pt-1.5 dark:border-amber-800/40">
          <section>
            <p className="mb-1.5 text-[11px] font-medium text-amber-900/90 dark:text-amber-100/90">
              {t('dev.newGuestThread')}
            </p>
            <div className="mb-1.5 grid gap-1.5 sm:grid-cols-2">
              <div className="space-y-0.5">
                <Label htmlFor="dev-guest-property" className="flex items-center gap-1 text-[10px]">
                  <Building2 className="h-3 w-3" />
                  {t('dev.propertyForGuest')}
                </Label>
                <Select
                  id="dev-guest-property"
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="h-8 w-full text-xs"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-0.5">
                <Label htmlFor="dev-guest-key" className="text-[10px]">
                  {t('dev.guestKey')}
                </Label>
                <Input
                  id="dev-guest-key"
                  value={guestKey}
                  onChange={(e) => setGuestKey(e.target.value)}
                  placeholder={t('dev.guestKeyPlaceholder')}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="[&_textarea]:min-h-[36px] [&_textarea]:py-2 [&_button]:h-9 [&_button]:w-9">
              <ChatInput
                onSend={handleSendNewThread}
                disabled={sendingNew || !propertyId}
                placeholder={t('dev.messagePlaceholder')}
              />
            </div>
          </section>

          <section className="border-t border-amber-200/50 pt-1.5 dark:border-amber-800/40">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-900/90 dark:text-amber-100/90">
              <User className="h-3 w-3" />
              {t('dev.guestInOpenDialog')}
              {openThreadLabel ? (
                <span className="truncate font-normal text-muted-foreground">· {openThreadLabel}</span>
              ) : null}
            </div>
            {!activeConversation && (
              <p className="mb-1 text-[10px] text-amber-800/75 dark:text-amber-200/75">
                {t('dev.selectDialogFirst')}
              </p>
            )}
            <div className="[&_textarea]:min-h-[36px] [&_textarea]:py-2 [&_button]:h-9 [&_button]:w-9">
              <ChatInput
                onSend={handleSendInOpenConversation}
                disabled={sendingOpen || !activeConversation}
                placeholder={t('guestInputPlaceholder')}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
