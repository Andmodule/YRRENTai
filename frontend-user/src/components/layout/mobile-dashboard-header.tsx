'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/utils';

const bar =
  'w-full bg-background/95 backdrop-blur-sm dark:bg-slate-900/85 border-b border-border/40';

/**
 * Мобильная шапка как у «Задачи» / «Чат»: меню слева, заголовок по центру, опционально слот справа.
 * Скрыта на `lg+` — там остаётся обычный заголовок в контенте.
 * @param embedded — без вылета на полную ширину и без нижней границы (например, внутри FilterBar).
 */
export function MobileDashboardHeader({
  title,
  right,
  className,
  embedded = false,
}: {
  title: string;
  right?: ReactNode;
  className?: string;
  embedded?: boolean;
}) {
  const t = useTranslations('tasks');
  const { toggleSidebar } = useUiStore();

  const headerInner = (
    <header
      className={cn(
        embedded
          ? 'w-full bg-background/95 backdrop-blur-sm dark:bg-slate-900/85'
          : bar,
        'relative flex h-14 items-center gap-2 px-3 pt-[max(0.25rem,env(safe-area-inset-top))] transition-colors duration-200',
        embedded && 'border-b-0',
      )}
    >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-10 h-10 w-10 shrink-0 text-muted-foreground"
          onClick={toggleSidebar}
          aria-label={t('mobileHeader.menuAria')}
        >
          <Menu className="h-6 w-6" aria-hidden />
        </Button>
        <h1 className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(16rem,calc(100%-7rem))] -translate-x-1/2 -translate-y-1/2 truncate text-center text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {right != null ? (
          <div className="relative z-10 ml-auto shrink-0">{right}</div>
        ) : (
          <div className="relative z-10 ml-auto h-10 w-10 shrink-0" aria-hidden />
        )}
    </header>
  );

  if (embedded) {
    return <div className={cn('lg:hidden w-full', className)}>{headerInner}</div>;
  }

  return (
    <div
      className={cn(
        'lg:hidden -mx-4 mb-4 w-[calc(100%+2rem)] sm:-mx-6 sm:mb-6 sm:w-[calc(100%+3rem)]',
        className,
      )}
    >
      {headerInner}
    </div>
  );
}
