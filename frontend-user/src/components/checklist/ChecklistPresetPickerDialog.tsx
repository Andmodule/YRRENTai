'use client';

import {
  ClipboardList,
  DoorOpen,
  FileEdit,
  LayoutGrid,
  Sparkles,
  Timer,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { PresetChoice } from '@/modules/checklist-templates/presets/professional-presets-2026';

const cards: {
  choice: PresetChoice;
  icon: typeof Sparkles;
  titleKey: 'checkoutTitle' | 'checkinTitle' | 'midStayTitle' | 'manualTitle' | 'blankTitle';
  descKey: 'checkoutDesc' | 'checkinDesc' | 'midStayDesc' | 'manualDesc' | 'blankDesc';
}[] = [
  {
    choice: 'checkout_cleaning',
    icon: DoorOpen,
    titleKey: 'checkoutTitle',
    descKey: 'checkoutDesc',
  },
  {
    choice: 'checkin_prep',
    icon: Sparkles,
    titleKey: 'checkinTitle',
    descKey: 'checkinDesc',
  },
  {
    choice: 'mid_stay_cleaning',
    icon: Timer,
    titleKey: 'midStayTitle',
    descKey: 'midStayDesc',
  },
  {
    choice: 'manual',
    icon: FileEdit,
    titleKey: 'manualTitle',
    descKey: 'manualDesc',
  },
  {
    choice: 'blank',
    icon: LayoutGrid,
    titleKey: 'blankTitle',
    descKey: 'blankDesc',
  },
];

export function ChecklistPresetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (choice: PresetChoice) => void;
}) {
  const t = useTranslations('checklist.presets');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('dialogTitle')}
        description={t('dialogSubtitle')}
        className="max-h-[90vh] max-w-3xl overflow-y-auto border border-white/10 bg-gradient-to-b from-slate-950/95 to-slate-900/90 shadow-2xl shadow-teal-950/20"
      >
        <div className="mb-2 flex items-center gap-2 text-teal-400">
          <ClipboardList className="h-5 w-5" aria-hidden />
          <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            {t('badge')}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map(({ choice, icon: Icon, titleKey, descKey }) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                onSelect(choice);
                onOpenChange(false);
              }}
              className={cn(
                'group relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-200',
                'border-white/10 bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-teal-950/20',
                'shadow-lg shadow-black/20',
                'hover:border-teal-400/40 hover:shadow-teal-900/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60',
                choice === 'blank' && 'border-dashed border-slate-600 hover:border-teal-500/50',
              )}
            >
              <span
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    'radial-gradient(800px circle at var(--x, 50%) var(--y, 0%), rgba(45, 212, 191, 0.08), transparent 40%)',
                }}
              />
              <div className="relative flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/20">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{t(titleKey)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(descKey)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
