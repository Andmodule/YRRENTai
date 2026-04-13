'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useCreateSupplyCatalogItem, useSupplyCatalogItems } from '../../hooks/useSupplyMatrix';

export function ManagerSupplyCatalogModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useSupplyCatalogItems(open);
  const { mutateAsync: createItem, isPending: createPending } = useCreateSupplyCatalogItem();

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addSynonyms, setAddSynonyms] = useState('');
  const [addUnit, setAddUnit] = useState('');
  const [search, setSearch] = useState('');

  const invalidateCatalogAndMatrix = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
  };

  const sortedFilteredItems = useMemo(() => {
    if (!items?.length) return [];
    const q = search.trim().toLowerCase();
    const base = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
    );
    if (!q) return base;
    return base.filter((it) => {
      const inName = it.name.toLowerCase().includes(q);
      const inAliases = (it.aliases ?? []).some((al) => al.toLowerCase().includes(q));
      const inUnit = it.defaultUnit?.toLowerCase().includes(q) ?? false;
      return inName || inAliases || inUnit;
    });
  }, [items, search, locale]);

  const submitAddCatalog = async () => {
    try {
      await createItem({
        name: addName.trim(),
        synonyms: addSynonyms.trim(),
        defaultUnit: addUnit.trim() || null,
        category: 'specificity',
      });
      toast.success(t('catalogAddSuccess'));
      setAddOpen(false);
      setAddName('');
      setAddSynonyms('');
      setAddUnit('');
      invalidateCatalogAndMatrix();
    } catch {
      toast.error(t('catalogAddError'));
    }
  };

  const titleWithCount =
    items != null ? `${t('catalogPreviewTitle')} (${items.length})` : t('catalogPreviewTitle');

  const catalogBody = (
    <>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="space-y-0.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('catalogSearchPlaceholder')}
              autoComplete="off"
              className={cn(
                'h-11 rounded-xl border border-primary/25 bg-muted pl-10 pr-4 text-base shadow-inner shadow-black/5',
                'placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
              )}
              aria-label={t('catalogSearchPlaceholder')}
            />
          </div>
          {sortedFilteredItems.length ? (
            <ul
              className="max-h-[min(60vh,520px)] space-y-0.5 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch]"
              role="list"
            >
              {sortedFilteredItems.map((it) => (
                <li
                  key={it.id}
                  className={cn(
                    'flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-border/45 bg-muted/25 px-3 py-2.5 text-sm shadow-sm',
                    'dark:border-border/35 dark:bg-muted/15',
                  )}
                >
                  <span className="min-w-0 font-medium leading-snug text-foreground">{it.name}</span>
                  {it.defaultUnit ? (
                    <span className="shrink-0 text-xs text-muted-foreground">· {it.defaultUnit}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {items?.length ? t('catalogSearchEmpty') : t('catalogEmptyHint')}
            </p>
          )}
        </>
      )}
    </>
  );

  const addForm = (
    <div className="space-y-3">
      <div>
        <Label htmlFor="supply-cat-name">{t('catalogName')}</Label>
        <Input
          id="supply-cat-name"
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          placeholder={t('catalogNamePlaceholder')}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="supply-cat-syn">{t('catalogSynonyms')}</Label>
        <Textarea
          id="supply-cat-syn"
          value={addSynonyms}
          onChange={(e) => setAddSynonyms(e.target.value)}
          placeholder={t('catalogSynonymsPlaceholder')}
          className="mt-1 min-h-[72px]"
        />
      </div>
      <div>
        <Label htmlFor="supply-cat-unit">{t('catalogUnit')}</Label>
        <Input
          id="supply-cat-unit"
          value={addUnit}
          onChange={(e) => setAddUnit(e.target.value)}
          placeholder={t('catalogUnitPlaceholder')}
          className="mt-1"
        />
      </div>
      <Button
        type="button"
        className="w-full bg-[#008CA4] hover:bg-[#007a90]"
        disabled={createPending || addName.trim().length < 2}
        onClick={() => void submitAddCatalog()}
      >
        {createPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('catalogSave')}
      </Button>
    </div>
  );

  return (
    <>
      <ResponsiveModal open={open} onOpenChange={onOpenChange} desktopPresentation="side">
        <ResponsiveModalContent
          title={titleWithCount}
          description={t('catalogPreviewHint')}
          headerAdornment={
            <div className="flex justify-end">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0 border-[#008CA4]/40 text-[#008CA4] hover:bg-[#E0F2F5] dark:border-[#00d4ff]/35 dark:text-[#a5f3fc]"
                aria-label={t('addCatalogItem')}
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          }
          bodyClassName="space-y-3 pt-2"
        >
          {catalogBody}
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ResponsiveModal open={addOpen} onOpenChange={setAddOpen} desktopPresentation="centered">
        <ResponsiveModalContent
          title={t('addCatalogItem')}
          description={t('addCatalogDescription')}
          stackAboveTaskLayer
        >
          {addForm}
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
