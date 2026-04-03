'use client';

import { use, useLayoutEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import {
  Building2,
  MapPin,
  Clock,
  Users,
  DollarSign,
  ArrowLeft,
  BookOpen,
  Settings,
  Pencil,
  Trash2,
  Globe,
  Link2,
} from 'lucide-react';
import { useProperty, useProperties } from '@/hooks/use-properties';
import { useKnowledgeBase } from '@/hooks/use-knowledge-base';
import { PropertyForm, DeletePropertyDialog, PropertyIntegrationsCard } from '@/components/property';
import { KbBoard, KbImportDialog } from '@/components/knowledge-base';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { CreatePropertyDto } from '@/types';

interface PropertyDetailPageProps {
  params: Promise<{ id: string }>;
}

type Tab = 'settings' | 'knowledge-base';

export default function PropertyDetailPage({ params }: PropertyDetailPageProps) {
  const { id } = use(params);
  const t = useTranslations('properties');
  const tKb = useTranslations('kb');
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('settings');
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  useLayoutEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('tab') === 'knowledge-base') {
      setActiveTab('knowledge-base');
    }
  }, []);

  const { property, isLoading, isError, mutate } = useProperty(id);
  const { updateProperty, deleteProperty } = useProperties();
  const { entries, isLoading: kbLoading, createEntry, updateEntry, deleteEntry, mutate: mutateKb } = useKnowledgeBase(id);

  async function handleUpdate(dto: CreatePropertyDto): Promise<void> {
    await updateProperty(id, dto);
    await mutate();
  }

  async function handleInlineSave(dto: CreatePropertyDto) {
    try {
      await handleUpdate(dto);
      setIsEditingSettings(false);
      toast.success(t('updateSuccess'));
    } catch {
      toast.error(t('updateError'));
    }
  }

  async function handleDelete() {
    await deleteProperty(id);
    router.replace('/properties');
  }

  if (isError) {
    return <ErrorState onRetry={() => mutate()} message={t('notFound')} />;
  }

  if (isLoading || !property) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-7 w-64" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const tabs: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: 'settings', icon: Settings, label: t('detail.settings') },
    { id: 'knowledge-base', icon: BookOpen, label: tKb('title') },
  ];

  const loc = (v: string) => (v && v !== '-' ? v : t('detail.notSpecified'));

  const details = [
    { icon: Globe, label: t('detail.country'), value: loc(property.country) },
    { icon: Building2, label: t('detail.city'), value: loc(property.city) },
    { icon: MapPin, label: t('detail.address'), value: property.address },
    { icon: Clock, label: t('detail.timezone'), value: property.timezone },
    { icon: DollarSign, label: t('detail.currency'), value: property.currency },
    {
      icon: Users,
      label: t('detail.maxGuests'),
      value: property.maxGuests ? String(property.maxGuests) : t('detail.notSpecified'),
    },
    {
      icon: Link2,
      label: t('detail.channels'),
      value:
        property.channelListings && property.channelListings.length > 0
          ? property.channelListings
              .map(
                (c) =>
                  `${c.otaPlatform?.code ?? '?'}: ${c.externalListingId}`,
              )
              .join(' · ')
          : property.zodomusPropertyId?.trim()
            ? `${property.otaPlatform?.code ?? 'OTA'} · ${property.zodomusPropertyId}`
            : t('detail.notSpecified'),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/properties">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{property.name}</h1>
              {property.description && !isEditingSettings && (
                <p className="text-sm text-muted-foreground line-clamp-1">{property.description}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'settings' && !isEditingSettings && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setIsEditingSettings(true)}
              aria-label={t('edit')}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {activeTab === 'settings' && isEditingSettings && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingSettings(false)}>
              {t('form.cancel')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex border-b">
        {tabs.map(({ id: tabId, icon: Icon, label }) => (
          <button
            key={tabId}
            type="button"
            onClick={() => {
              setActiveTab(tabId);
              if (tabId !== 'settings') setIsEditingSettings(false);
            }}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === tabId
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {tabId === 'knowledge-base' && entries.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {entries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && (
        <div className="space-y-4">
          {isEditingSettings ? (
            <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.02] p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <Building2 className="h-4 w-4 text-primary" />
                {t('editTitle')}
              </div>
              <PropertyForm
                key={`${property.id}-${property.updatedAt}`}
                defaultValues={property}
                onSubmit={handleInlineSave}
                onCancel={() => setIsEditingSettings(false)}
                submitLabel={t('updateSubmit')}
              />
              <div className="mt-4 flex justify-start border-t border-border pt-4">
                <DeletePropertyDialog
                  propertyName={property.name}
                  onDelete={handleDelete}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('delete')}
                    </Button>
                  }
                />
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border bg-card shadow-sm">
                <dl className="divide-y">
                  {details.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center justify-between px-5 py-4">
                      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </dt>
                      <dd className="text-sm font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {property.description && (
                <div className="rounded-lg border bg-card p-5 shadow-sm">
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                    {t('form.description')}
                  </h2>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{property.description}</p>
                </div>
              )}

              <PropertyIntegrationsCard
                propertyId={property.id}
                zodomusPropertyId={property.zodomusPropertyId}
                channelListings={property.channelListings}
                otaPlatform={property.otaPlatform ?? null}
                onSynced={async () => {
                  await mutate();
                }}
              />
            </>
          )}
        </div>
      )}

      {activeTab === 'knowledge-base' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{tKb('subtitle')}</p>
            <KbImportDialog propertyId={id} onConfirmed={() => void mutateKb()} />
          </div>
          <KbBoard
            key={id}
            entries={entries}
            isLoading={kbLoading}
            onCreate={createEntry}
            onUpdate={(entryId, data) => updateEntry(entryId, data)}
            onDelete={deleteEntry}
          />
        </div>
      )}
    </div>
  );
}
