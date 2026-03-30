'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import { PropertyCard, PropertyCardSkeleton, PropertyDraftCard } from '@/components/property';
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {!draftOpen && (
          <Button type="button" onClick={() => setDraftOpen(true)}>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <PropertyCardSkeleton key={i} />
          ))}
        </div>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
