'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CompanyGlobalQaEntry } from '@rentai/shared';
import { useCompanyGlobalRules } from '@/hooks/use-company-global-rules';
import { CompanyGlobalQaSection, sanitizeQaEntriesForSave } from './company-global-qa-section';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';

export function CompanyGlobalRulesForm() {
  const t = useTranslations('properties.globalRules');
  const { rules, isLoading, isError, mutate, updateRules } = useCompanyGlobalRules();
  const [description, setDescription] = useState('');
  const [houseRules, setHouseRules] = useState('');
  const [qaEntries, setQaEntries] = useState<CompanyGlobalQaEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDescription(rules.globalDescription ?? '');
    setHouseRules(rules.globalRules ?? '');
    setQaEntries(rules.globalQaEntries ?? []);
  }, [rules.globalDescription, rules.globalRules, rules.globalQaEntries]);

  async function handleSave() {
    setSaving(true);
    try {
      const savedQa = sanitizeQaEntriesForSave(qaEntries);
      await updateRules({
        globalDescription: description.trim() || null,
        globalRules: houseRules.trim() || null,
        globalQaEntries: savedQa,
      });
      setQaEntries(savedQa);
      toast.success(t('saveSuccess'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {t('loadError')}
        <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => mutate()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('intro')}</p>
      <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200/90">
        {t('overrideHint')}
      </p>

      <div className="space-y-2">
        <Label htmlFor="global-description">{t('descriptionLabel')}</Label>
        <Textarea
          id="global-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('descriptionPlaceholder')}
          rows={4}
          maxLength={5000}
          className="resize-y min-h-[100px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="global-rules">{t('rulesLabel')}</Label>
        <Textarea
          id="global-rules"
          value={houseRules}
          onChange={(e) => setHouseRules(e.target.value)}
          placeholder={t('rulesPlaceholder')}
          rows={10}
          maxLength={10000}
          className="resize-y min-h-[200px]"
        />
      </div>

      <CompanyGlobalQaSection entries={qaEntries} onChange={setQaEntries} />

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('saving')}
            </>
          ) : (
            t('save')
          )}
        </Button>
      </div>
    </div>
  );
}
