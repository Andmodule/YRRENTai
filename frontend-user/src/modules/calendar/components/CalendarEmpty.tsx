'use client';

import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export function CalendarEmptyNoProperties() {
  const t = useTranslations('calendar');
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Building2 className="h-12 w-12 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground">{t('emptyNoProperties')}</p>
      <Button asChild>
        <Link href="/properties">{t('addProperty')}</Link>
      </Button>
    </div>
  );
}

export function CalendarEmptyNoReservations() {
  const t = useTranslations('calendar');
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <p className="text-sm text-gray-400">{t('emptyNoReservations')}</p>
    </div>
  );
}
