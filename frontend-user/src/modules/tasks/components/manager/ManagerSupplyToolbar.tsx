'use client';

import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tasksChipActiveClasses } from '../../tasks-chip-classes';

/** Панель «Справочник / портал водителю / Добавить довоз» — в одну линию с вкладками «Задачи / Снабжение». */
export function ManagerSupplyToolbar({
  catalogOpen,
  onCatalogOpenChange,
  onCreateClick,
  matrixToolbarHostRef,
}: {
  catalogOpen: boolean;
  onCatalogOpenChange: (open: boolean) => void;
  onCreateClick: () => void;
  matrixToolbarHostRef: (el: HTMLDivElement | null) => void;
}) {
  const t = useTranslations('tasks.managerSupply');
  const tCreate = useTranslations('tasks.managerSupply.supplyCreate');

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-2 md:max-w-[min(100%,42rem)] md:flex-1 md:flex-row md:items-center md:justify-end md:gap-2 lg:max-w-none">
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          className={cn(
            'min-w-0 shrink-0 max-w-full truncate rounded-full px-2.5 py-1 text-left text-xs font-medium transition-colors sm:px-3 sm:max-w-none',
            catalogOpen ? tasksChipActiveClasses : 'text-muted-foreground',
          )}
          aria-expanded={catalogOpen}
          aria-haspopup="dialog"
          onClick={() => onCatalogOpenChange(true)}
        >
          {t('catalogPreviewTitle')}
        </button>
        <div ref={matrixToolbarHostRef} className="flex min-w-0 shrink-0 items-center" />
      </div>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-8 w-full shrink-0 gap-1.5 sm:h-9 sm:w-auto"
        onClick={onCreateClick}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {tCreate('triggerButton')}
      </Button>
    </div>
  );
}
