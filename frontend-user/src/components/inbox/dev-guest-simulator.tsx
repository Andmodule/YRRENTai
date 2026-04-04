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
  /** After DB wipe — refresh inbox and clear selection. */
  onChatsCleared?: () => void;
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
  className,
}: DevGuestSimulatorProps) {
  const t = useTranslations('inbox');
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

  async function handleSendNewThread(content: string) {
    if (!propertyId) return;
    const key = guestKey.trim() || 'default';
    setSendingNew(true);
    try {
      await connectChatSocket();
      const s = getChatSocket();
      if (!s?.connected) return;
      s.emit('message:send', {
        propertyId,
        content: content.trim(),
        guestSessionKey: key,
      });
    } finally {
      setSendingNew(false);
    }
  }

  async function handleSendInOpenConversation(content: string) {
    if (!activeConversation) return;
    setSendingOpen(true);
    try {
      await connectChatSocket();
      const s = getChatSocket();
      if (!s?.connected) return;
      s.emit('message:send', {
        propertyId: activeConversation.propertyId,
        conversationId: activeConversation.id,
        content: content.trim(),
      });
    } finally {
      setSendingOpen(false);
    }
  }

  async function handleClearAllChats() {
    if (!window.confirm(t('dev.clearAllChatsConfirm'))) return;
    setClearing(true);
    try {
      await apiClient.post('/chats/dev/clear-all');
      toast.success(t('dev.clearAllChatsSuccess'));
      onChatsCleared?.();
    } catch {
      toast.error(t('dev.clearAllChatsError'));
    } finally {
      setClearing(false);
    }
  }

  if (properties.length === 0) return null;

  return (
    <details
      className={cn(
        'group rounded-lg border border-dashed border-amber-300/80 bg-amber-50/40 dark:border-amber-700/50 dark:bg-amber-950/20',
        className,
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-amber-900 dark:text-amber-100',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" />
          {t('dev.panelSummary')}
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={clearing}
                aria-label={t('dev.clearAllChatsIconAria')}
                title={t('dev.clearAllChats')}
                className={cn(
                  'h-8 w-8 shrink-0 rounded-md border border-amber-400/55 text-amber-900',
                  'bg-amber-500/15 hover:bg-amber-500/25 hover:text-amber-950',
                  'dark:border-amber-600/45 dark:text-amber-100 dark:hover:bg-amber-500/20 dark:hover:text-amber-50',
                  clearing && 'pointer-events-none opacity-70',
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleClearAllChats();
                }}
              >
                {clearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              <p className="font-medium">{t('dev.clearAllChats')}</p>
              <p className="mt-1 text-muted-foreground">{t('dev.clearAllChatsTooltipDb')}</p>
            </TooltipContent>
          </Tooltip>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="space-y-4 border-t border-amber-200/60 px-4 pb-4 pt-3 dark:border-amber-800/50">
        {/* New thread */}
        <div>
          <p className="mb-2 text-xs font-medium text-amber-900/90 dark:text-amber-100/90">
            {t('dev.newGuestThread')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">{t('dev.newGuestHint')}</p>

          <div className="mb-3 space-y-1.5">
            <Label htmlFor="dev-guest-property" className="flex items-center gap-1.5 text-xs font-medium">
              <Building2 className="h-3.5 w-3.5" />
              {t('dev.propertyForGuest')}
            </Label>
            <Select
              id="dev-guest-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="w-full max-w-md"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="mb-3 space-y-1.5">
            <Label htmlFor="dev-guest-key" className="text-xs">
              {t('dev.guestKey')}
            </Label>
            <Input
              id="dev-guest-key"
              value={guestKey}
              onChange={(e) => setGuestKey(e.target.value)}
              placeholder={t('dev.guestKeyPlaceholder')}
              className="h-9 text-sm"
            />
          </div>
          <ChatInput
            onSend={handleSendNewThread}
            disabled={sendingNew || !propertyId}
            placeholder={t('dev.messagePlaceholder')}
          />
        </div>

        {/* Current inbox row */}
        <div className="border-t border-amber-200/60 pt-4 dark:border-amber-800/50">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-900/90 dark:text-amber-100/90">
            <User className="h-3.5 w-3.5" />
            {t('dev.guestInOpenDialog')}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-muted-foreground">{t('guestAsUserHint')}</p>
          {activeConversation ? (
            <p className="mb-2 truncate text-[11px] text-muted-foreground">
              {activeConversation.propertyName}
              {activeConversation.externalGuestKey
                ? ` · ${emailLikeFromExternalGuestKey(activeConversation.externalGuestKey)}`
                : ''}
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-amber-800/80 dark:text-amber-200/80">{t('dev.selectDialogFirst')}</p>
          )}
          <ChatInput
            onSend={handleSendInOpenConversation}
            disabled={sendingOpen || !activeConversation}
            placeholder={t('guestInputPlaceholder')}
          />
        </div>
      </div>
    </details>
  );
}
