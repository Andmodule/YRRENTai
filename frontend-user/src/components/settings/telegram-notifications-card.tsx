'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Send, CheckCircle2, Info } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useUserTelegram } from '@/hooks/use-user-telegram';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';

export function TelegramNotificationsCard() {
  const tTg = useTranslations('settings.telegram');
  const { isLoading } = useAuth();
  const { telegramChatId, setTelegramChatId, isSaving, save, isConnected } = useUserTelegram();

  async function handleSave() {
    try {
      await save(telegramChatId.trim() || null);
      toast.success(tTg('saveSuccess'));
    } catch {
      toast.error(tTg('saveError'));
    }
  }

  return (
    <SettingsSectionCard title={tTg('title')} description={tTg('subtitle')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Send className="h-4 w-4" />
        </div>
        {isLoading ? (
          <Skeleton className="h-5 w-28" />
        ) : isConnected ? (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {tTg('connected')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{tTg('notConnected')}</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="account-tg-chat-id">{tTg('chatId')}</Label>
            <p className="text-xs text-muted-foreground">{tTg('chatIdHint')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="account-tg-chat-id"
                placeholder={tTg('chatIdPlaceholder')}
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
                className="min-w-0 flex-1"
              />
              <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
                {tTg('save')}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{tTg('overrideNote')}</span>
          </div>
        </>
      )}
    </SettingsSectionCard>
  );
}
