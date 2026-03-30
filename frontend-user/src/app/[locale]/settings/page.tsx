'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Settings, Send, CheckCircle2, Info } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useUserTelegram } from '@/hooks/use-user-telegram';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tTg = useTranslations('settings.telegram');
  const { user, isLoading } = useAuth();
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
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">{t('title')}</h1>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">{tTg('title')}</h2>
            </div>
            {isLoading ? (
              <Skeleton className="h-5 w-28" />
            ) : isConnected ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {tTg('connected')}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{tTg('notConnected')}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tTg('subtitle')}</p>
        </div>

        <div className="space-y-4 px-5 py-5">
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
                <div className="flex gap-2">
                  <Input
                    id="account-tg-chat-id"
                    placeholder={tTg('chatIdPlaceholder')}
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
                  />
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                  >
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
        </div>
      </div>
    </div>
  );
}
