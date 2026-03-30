'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { KB_CATEGORY_CHIPS_INITIAL, CATEGORY_ICONS, CATEGORY_STYLES } from './kb-category-badge';
import type { KbCategory } from '@/types';

type Variant = 'filled' | 'dashed';

interface ExpandableCategoryChipsProps {
  categories: KbCategory[];
  onSelect: (cat: KbCategory) => void;
  variant?: Variant;
  initialVisible?: number;
}

export function ExpandableCategoryChips({
  categories,
  onSelect,
  variant = 'filled',
  initialVisible = KB_CATEGORY_CHIPS_INITIAL,
}: ExpandableCategoryChipsProps) {
  const t = useTranslations('kb');
  const tCat = useTranslations('kb.categories');
  const [expanded, setExpanded] = useState(false);

  if (categories.length === 0) return null;

  const showToggle = categories.length > initialVisible;
  const visible = expanded ? categories : categories.slice(0, initialVisible);
  const restCount = categories.length - initialVisible;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          'flex flex-wrap justify-center gap-2',
          variant === 'dashed' && 'w-full',
        )}
      >
        {visible.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onSelect(cat)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.02] active:scale-[0.98]',
              variant === 'filled' && (CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other),
              variant === 'dashed' &&
                'border border-dashed text-muted-foreground hover:border-foreground/40 hover:text-foreground',
            )}
          >
            {variant === 'dashed' && <Plus className="h-3 w-3 shrink-0" />}
            <span>{CATEGORY_ICONS[cat]}</span>
            <span>{tCat(cat)}</span>
          </button>
        ))}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              {t('showLessCategories')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              {t('moreCategories', { count: restCount })}
            </>
          )}
        </button>
      )}
    </div>
  );
}
