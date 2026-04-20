'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { postOperatorTakeover } from '@/lib/api/calls';
import { toast } from 'sonner';

interface TakeoverButtonProps {
  sessionId: string;
  disabled?: boolean;
  onTakeover?: () => void;
}

export function TakeoverButton({ sessionId, disabled, onTakeover }: TakeoverButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleTakeover = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await postOperatorTakeover(sessionId);
      toast.success('Вы взяли звонок под управление');
      onTakeover?.();
    } catch {
      toast.error('Не удалось перехватить звонок');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={disabled || loading}
      onClick={() => void handleTakeover()}
      className="gap-1.5"
    >
      <span className="text-base leading-none">🎙</span>
      {loading ? 'Перехват...' : 'Взять звонок'}
    </Button>
  );
}
