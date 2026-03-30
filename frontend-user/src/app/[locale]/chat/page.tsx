'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, MessageSquare } from 'lucide-react';
import { useProperties } from '@/hooks/use-properties';
import { useUiStore } from '@/stores/ui.store';
import { ChatWindow } from '@/components/chat';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function ChatPage() {
  const t = useTranslations('chat');
  const { properties, isLoading } = useProperties();
  const { activePropertyId, setActivePropertyId } = useUiStore();

  useEffect(() => {
    if (!activePropertyId && properties.length > 0 && properties[0]) {
      setActivePropertyId(properties[0].id);
    }
  }, [activePropertyId, properties, setActivePropertyId]);

  const selectedProperty = properties.find((p) => p.id === activePropertyId);

  if (isLoading) {
    return (
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title={t('noProperties')}
          description={t('noPropertiesHint')}
          action={
            <Button asChild>
              <Link href="/properties">{t('goToProperties')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {t('devMode')}
          </span>
        </div>
        <Select
          value={activePropertyId ?? ''}
          onChange={(e) => setActivePropertyId(e.target.value)}
          className="w-auto min-w-[200px]"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {selectedProperty && activePropertyId && (
        <div className="flex-1 min-h-0">
          <ChatWindow
            key={activePropertyId}
            propertyId={activePropertyId}
            propertyName={selectedProperty.name}
          />
        </div>
      )}
    </div>
  );
}
