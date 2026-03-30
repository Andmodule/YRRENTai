import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from './use-auth';

export function useUserTelegram() {
  const { user, mutate: mutateAuth } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const [localChatId, setLocalChatId] = useState<string>(user?.telegramChatId ?? '');

  useEffect(() => {
    setLocalChatId(user?.telegramChatId ?? '');
  }, [user?.telegramChatId]);

  async function save(telegramChatId: string | null): Promise<void> {
    setIsSaving(true);
    try {
      await apiClient.patch('/users/me/telegram', { telegramChatId: telegramChatId || null });
      await mutateAuth();
    } finally {
      setIsSaving(false);
    }
  }

  return {
    telegramChatId: localChatId,
    setTelegramChatId: setLocalChatId,
    isSaving,
    save,
    isConnected: !!user?.telegramChatId,
  };
}
