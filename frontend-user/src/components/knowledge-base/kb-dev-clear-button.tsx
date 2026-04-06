'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';

interface ClearResponse {
  data: { deleted: number };
}

interface KbDevClearButtonProps {
  propertyId: string;
  entryCount: number;
  onCleared: () => void;
}

export function KbDevClearButton({ propertyId, entryCount, onCleared }: KbDevClearButtonProps) {
  const t = useTranslations('kb');
  const [loading, setLoading] = useState(false);

  async function handleClear() {
    if (entryCount === 0) {
      toast.message(t('dev.nothingToClear'));
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(t('dev.confirm', { count: entryCount }))) {
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<ClearResponse>(
        `/knowledge-base/${propertyId}/dev/clear-all`,
      );
      toast.success(t('dev.success', { count: res.data.data.deleted }));
      onCleared();
    } catch {
      toast.error(t('dev.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={loading || entryCount === 0}
      onClick={() => void handleClear()}
      title={t('dev.title')}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="mr-2 h-4 w-4" />
      )}
      {t('dev.button')}
    </Button>
  );
}
