'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSWRConfig } from 'swr';
import { useProperties } from '@/hooks/use-properties';
import { useListingTranslations, upsertListingTranslation } from '@/modules/operations/hooks/use-operations-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const LOCALES = ['en', 'ru', 'pl', 'de', 'es'] as const;

export default function OperationsListingsPage() {
  const t = useTranslations('operations.listings');
  const { properties, isLoading: propsLoading } = useProperties();
  const [propertyId, setPropertyId] = useState<string>('');
  const { data, isLoading, mutate } = useListingTranslations(propertyId || null);
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    const first = properties[0];
    if (!propertyId && first) {
      setPropertyId(first.id);
    }
  }, [properties, propertyId]);

  const rows = data?.translations ?? [];
  const [activeLocale, setActiveLocale] = useState<string>('en');
  const row = rows.find((r) => r.locale === activeLocale);
  const [draft, setDraft] = useState({ title: '', shortDescription: '', longDescription: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      setDraft({
        title: row.title ?? '',
        shortDescription: row.shortDescription ?? '',
        longDescription: row.longDescription ?? '',
      });
    }
  }, [row?.id, row?.locale, row?.title, row?.shortDescription, row?.longDescription, activeLocale]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) return;
    setSaving(true);
    try {
      await upsertListingTranslation(propertyId, activeLocale, {
        title: draft.title.trim() || null,
        shortDescription: draft.shortDescription.trim() || null,
        longDescription: draft.longDescription.trim() || null,
      });
      await mutate();
      await globalMutate((k) => typeof k === 'string' && k.includes('/operations/reports'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">{t('hint')}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="lt-property">{t('property')}</Label>
          <Select
            id="lt-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={propsLoading || properties.length === 0}
          >
            <option value="">{t('propertyPlaceholder')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="lt-locale">{t('channelLocale')}</Label>
          <Select
            id="lt-locale"
            value={activeLocale}
            onChange={(e) => setActiveLocale(e.target.value)}
          >
            {LOCALES.map((loc) => (
              <option key={loc} value={loc}>
                {t(`locales.${loc}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {propertyId && (
        <>
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 bg-slate-800" />
              <Skeleton className="h-24 bg-slate-800" />
            </div>
          )}
          {!isLoading && row && (
            <form onSubmit={onSave} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="lt-title">{t('title')}</Label>
                <Input
                  id="lt-title"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder={t('titlePlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lt-short">{t('shortDescription')}</Label>
                <Textarea
                  id="lt-short"
                  rows={3}
                  value={draft.shortDescription}
                  onChange={(e) => setDraft((d) => ({ ...d, shortDescription: e.target.value }))}
                  placeholder={t('shortPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lt-long">{t('longDescription')}</Label>
                <Textarea
                  id="lt-long"
                  rows={6}
                  value={draft.longDescription}
                  onChange={(e) => setDraft((d) => ({ ...d, longDescription: e.target.value }))}
                  placeholder={t('longPlaceholder')}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? '…' : t('save')}
              </Button>
            </form>
          )}
        </>
      )}

      {!propertyId && !propsLoading && (
        <p className="text-sm text-slate-500">{t('noProperties')}</p>
      )}
    </div>
  );
}
