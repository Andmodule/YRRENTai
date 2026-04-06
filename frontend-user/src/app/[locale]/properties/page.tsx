'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { PropertyListTable, PropertyTableSkeleton, PropertyDraftCard } from '@/components/property';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';
import type { CreatePropertyDto } from '@/types';

const CREATE_BTN_CLASS =
  'rounded-full border border-[#00e5ff] bg-transparent text-[#00e5ff] shadow-none hover:bg-[#00e5ff]/12 hover:text-[#00e5ff]';

export default function PropertiesPage() {
  const t = useTranslations('properties');
  const router = useRouter();
  const { properties, isLoading, isError, mutate, createProperty } = useProperties();
  const [draftOpen, setDraftOpen] = useState(false);
  const setPropertyCreateHandler = useUiStore((s) => s.setPropertyCreateHandler);

  useEffect(() => {
    setPropertyCreateHandler(() => setDraftOpen(true));
    return () => setPropertyCreateHandler(null);
  }, [setPropertyCreateHandler]);

  async function handleCreate(dto: CreatePropertyDto) {
    const property = await createProperty(dto);
    setDraftOpen(false);
    router.push(`/properties/${property.id}?tab=knowledge-base`);
  }

  if (isError) {
    return <ErrorState onRetry={() => mutate()} />;
  }

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
      {draftOpen && (
        <PropertyDraftCard
          onCreate={handleCreate}
          onDiscard={() => setDraftOpen(false)}
        />
      )}

      {isLoading ? (
        <PropertyTableSkeleton />
      ) : properties.length === 0 && !draftOpen ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Button type="button" variant="ghost" className={cn('h-10 gap-2 px-5', CREATE_BTN_CLASS)} onClick={() => setDraftOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={2.25} />
              {t('addProperty')}
            </Button>
          }
        />
      ) : properties.length > 0 ? (
        <PropertyListTable properties={properties} />
      ) : null}
      </div>
    </>
  );
}
