'use client';

import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const tileClassName = (className?: string) =>
  cn(
    'group flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl',
    'border-2 border-dashed border-teal-400/90 bg-white/60 p-0.5 text-center',
    'transition active:scale-[0.98] dark:border-teal-500/75 dark:bg-slate-800/50',
    'hover:border-teal-500 hover:bg-teal-50/90 dark:hover:border-teal-400/90 dark:hover:bg-teal-950/45',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:ring-offset-slate-900',
    'cursor-pointer',
    className,
  );

type Props = {
  line1: string;
  line2: string;
  /** Полная фраза для a11y (например «Снять / из галереи»). */
  ariaLabel: string;
  onClick?: () => void;
  className?: string;
  /**
   * Если задан, плитка — `<label htmlFor="…">` к `input` (как в `PhotoVerificationDrawer` — `input` до `Drawer` в соседнем фрагменте).
   */
  htmlFor?: string;
};

/**
 * Компактная плитка «добавить фото/видео» — в одной строке с миниатюрами, при нехватке ширины переносится (`flex-wrap`).
 */
export function VerificationAddMediaTile({ line1, line2, ariaLabel, onClick, className, htmlFor }: Props) {
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} aria-label={ariaLabel} className={tileClassName(className)}>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-800 shadow-sm dark:bg-teal-900/60 dark:text-teal-200"
          aria-hidden
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span className="px-0.5 text-center text-[9px] font-medium leading-tight text-teal-800 dark:text-teal-200">
          <span className="block leading-tight">{line1}</span>
          <span className="block leading-tight">{line2}</span>
        </span>
      </label>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={tileClassName(className)}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-800 shadow-sm dark:bg-teal-900/60 dark:text-teal-200"
        aria-hidden
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className="px-0.5 text-center text-[9px] font-medium leading-tight text-teal-800 dark:text-teal-200">
        <span className="block leading-tight">{line1}</span>
        <span className="block leading-tight">{line2}</span>
      </span>
    </button>
  );
}
