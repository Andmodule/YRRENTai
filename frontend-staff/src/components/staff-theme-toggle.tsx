'use client';

import { Moon, Sun } from 'lucide-react';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';
import { useStaffTheme } from '@/components/staff-theme';

/** Как кнопки календаря / истории / выхода в шапке водителя — заметная в светлой и тёмной теме. */
const btnClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-transform hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-amber-100 dark:shadow-none dark:hover:bg-slate-700';

export function StaffThemeToggle({ className }: { className?: string }) {
  const { mode, toggle } = useStaffTheme();
  const t = useStaffStrings().staffShell.themeToggle;
  const isDark = mode === 'dark';

  return (
    <button
      type="button"
      className={cn(btnClass, className)}
      onClick={() => toggle()}
      aria-label={isDark ? t.switchToLightAria : t.switchToDarkAria}
      title={isDark ? t.switchToLightAria : t.switchToDarkAria}
    >
      {isDark ? <Sun className="h-5 w-5" strokeWidth={2} aria-hidden /> : <Moon className="h-5 w-5" strokeWidth={2} aria-hidden />}
    </button>
  );
}
