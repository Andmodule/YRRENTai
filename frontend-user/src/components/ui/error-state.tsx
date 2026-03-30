'use client';

import { useTranslations } from 'next-intl';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  message?: string;
  requestId?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, requestId, onRetry, className }: ErrorStateProps) {
  const t = useTranslations('common');

  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <div className="mb-4 text-4xl">⚠</div>
      <h3 className="text-lg font-semibold">{message || t('error')}</h3>
      {requestId && (
        <p className="mt-2 text-xs text-muted-foreground">Request ID: {requestId}</p>
      )}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
