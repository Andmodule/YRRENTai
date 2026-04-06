'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { PropertyListTable, PropertyTableSkeleton, PropertyDraftCard } from '@/components/property';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import type { CreatePropertyDto } from '@/types';

export default function PropertiesPage() {
  const t = useTranslations('properties');
  const router = useRouter();
  const { properties, isLoading, isError, mutate, createProperty } = useProperties();
  const [draftOpen, setDraftOpen] = useState(false);

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {!draftOpen && (
            <Button type="button" className="h-11 w-full shrink-0 sm:h-10 sm:w-auto" onClick={() => setDraftOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addProperty')}
            </Button>
          )}
        </div>

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
            <Button type="button" onClick={() => setDraftOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
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
