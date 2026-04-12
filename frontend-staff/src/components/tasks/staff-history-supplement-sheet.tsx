'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useStaffInterpretText } from '@/hooks/use-tasks';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';

export type StaffSupplementContext = {
  kind: 'task' | 'incident' | 'property';
  id: string;
  label: string;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Строка — только «Метка:» и пробелы, без текста после двоеточия. */
function lineIsBareLabelColon(line: string, label: string): boolean {
  return new RegExp(`^${escapeRegex(label)}:\\s*$`).test(line);
}

function lastLineNeedsAfterColonHint(text: string, refillLabel: string, incidentLabel: string): boolean {
  const lines = text.split('\n');
  const last = lines[lines.length - 1] ?? '';
  return lineIsBareLabelColon(last, refillLabel) || lineIsBareLabelColon(last, incidentLabel);
}

/** Единый акцент с `globals.css` / кнопками staff (teal). */
const CHIP_CLASS =
  'rounded-full border border-teal-600/70 bg-teal-50/80 px-3.5 py-1.5 text-xs font-semibold text-teal-800 shadow-sm transition-colors hover:bg-teal-100/90 active:bg-teal-100 disabled:opacity-50';

export function StaffHistorySupplementSheet({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: StaffSupplementContext | null;
}) {
  const h = useStaffStrings().tasks.history;
  const [text, setText] = useState('');
  const [fieldFocused, setFieldFocused] = useState(false);
  const [usedRefill, setUsedRefill] = useState(false);
  const [usedIncident, setUsedIncident] = useState(false);
  const { mutateAsync: submit, isPending } = useStaffInterpretText();

  useEffect(() => {
    if (open) {
      setText('');
      setFieldFocused(false);
      setUsedRefill(false);
      setUsedIncident(false);
    }
  }, [open, context?.id]);

  const insertChipLine = (kind: 'refill' | 'incident', label: string) => {
    if (kind === 'refill' && usedRefill) return;
    if (kind === 'incident' && usedIncident) return;
    const line = `${label.trim()}: `;
    setText((prev) => {
      const p = prev.trimEnd();
      if (!p) return line;
      return `${p}\n${line}`;
    });
    if (kind === 'refill') setUsedRefill(true);
    else setUsedIncident(true);
  };

  const showAfterColonHint =
    !fieldFocused &&
    text.trim().length > 0 &&
    lastLineNeedsAfterColonHint(text, h.supplementChipRefill, h.supplementChipIncident);

  const handleSubmit = async () => {
    const t = text.trim();
    if (t.length < 3) {
      toast.error(h.supplementError);
      return;
    }
    if (!context) return;
    try {
      await submit({
        entryPoint: 'history_supplement',
        targetType: context.kind,
        targetId: context.id,
        text: t,
      });
      toast.success(h.supplementSuccess);
      onOpenChange(false);
    } catch {
      toast.error(h.supplementError);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={h.supplementTitle}>
        {context && (
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{context.label}</p>
        )}
        <p className="mb-3 text-[15px] font-normal leading-relaxed text-slate-900">{h.supplementHint}</p>

        <div
          className={cn(
            'staff-card overflow-hidden rounded-xl border border-slate-200/95 bg-white p-0 shadow-sm',
            fieldFocused && 'ring-2 ring-teal-500/30 ring-offset-0',
          )}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFieldFocused(true)}
            onBlur={() => setFieldFocused(false)}
            placeholder={h.supplementPlaceholder}
            className="min-h-[120px] resize-none rounded-none border-0 bg-white text-base text-slate-900 shadow-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/20 focus-visible:ring-offset-0 placeholder:text-slate-600"
            maxLength={8000}
            disabled={isPending}
            aria-describedby={showAfterColonHint ? 'supplement-after-colon-hint' : undefined}
          />
          {showAfterColonHint ? (
            <p
              id="supplement-after-colon-hint"
              className="pointer-events-none border-t border-slate-300 bg-slate-100 px-3 py-2.5 text-sm font-medium leading-relaxed text-slate-900"
            >
              {h.supplementAfterColonHint}
            </p>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          {!usedRefill ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => insertChipLine('refill', h.supplementChipRefill)}
              className={CHIP_CLASS}
            >
              {h.supplementChipRefill}
            </button>
          ) : null}
          {!usedIncident ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => insertChipLine('incident', h.supplementChipIncident)}
              className={CHIP_CLASS}
            >
              {h.supplementChipIncident}
            </button>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-xl"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {h.incidentPhotoCancel}
          </Button>
          <Button
            type="button"
            className="flex-1 rounded-xl"
            disabled={isPending || text.trim().length < 3}
            onClick={() => void handleSubmit()}
          >
            {isPending ? h.photosUploading : h.supplementSubmit}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
