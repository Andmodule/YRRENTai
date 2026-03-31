'use client';

import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface CalendarErrorProps {
  onRetry: () => void;
}

export function CalendarError({ onRetry }: CalendarErrorProps) {
  const t = useTranslations('calendar');
  return (
    <Alert variant="destructive" className="mx-auto max-w-lg">
      <AlertDescription>{t('loadError')}</AlertDescription>
      <Button variant="outline" size="sm" className="mt-3" type="button" onClick={onRetry}>
        {t('retry')}
      </Button>
    </Alert>
  );
}
