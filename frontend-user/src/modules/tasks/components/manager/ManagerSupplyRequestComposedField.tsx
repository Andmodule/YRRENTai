'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { SupplyCatalogLite } from '@/modules/tasks/utils/supply-catalog-units';
import {
  findCatalogMatchForLine,
  formatSupplyCatalogRequestLine,
  parseCatalogUnitOptions,
  parsePositiveIntQty,
  parseQtyAndUnitAfterName,
  replaceLineInMultilineText,
} from '@/modules/tasks/utils/supply-catalog-units';

function CatalogQtyInput({
  qty,
  onCommit,
  ariaLabel,
}: {
  qty: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const [local, setLocal] = useState(() => String(qty));
  useEffect(() => {
    setLocal(String(qty));
  }, [qty]);

  /** Свой `<input>` без `w-full` из ui/Input — нужен компактный квадрат. */
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      value={local}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '');
        setLocal(v);
      }}
      onBlur={() => {
        const n = parsePositiveIntQty(local);
        setLocal(String(n));
        if (n !== qty) onCommit(n);
      }}
      className={cn(
        'box-border size-8 shrink-0 rounded border border-border bg-background px-0 text-center text-xs font-medium tabular-nums text-foreground',
        'outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
      )}
    />
  );
}

export function ManagerSupplyRequestComposedField({
  id,
  value,
  onChange,
  placeholder,
  catalogItems,
}: {
  id: string;
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  placeholder: string;
  catalogItems: SupplyCatalogLite[];
}) {
  const t = useTranslations('tasks.managerSupply.supplyCreate');
  const [focusedFreeIndex, setFocusedFreeIndex] = useState<number | null>(null);

  const rawLines = value.split(/\r?\n/);
  /** Всегда держим пустую строку внизу для ручного ввода, если последняя строка не пустая. */
  const appendTrailingFree =
    rawLines.length === 0 || rawLines[rawLines.length - 1] !== '';
  const rows: { index: number; line: string }[] = rawLines.map((line, index) => ({ index, line }));
  if (appendTrailingFree) {
    rows.push({ index: rawLines.length, line: '' });
  }

  const applyCatalogPatch = (lineIndex: number, overrides: { qty?: number; unit?: string | null }) => {
    onChange((prev) => {
      const cur = prev.split(/\r?\n/)[lineIndex] ?? '';
      const m = findCatalogMatchForLine(cur, catalogItems);
      if (!m) return prev;
      const opts = parseCatalogUnitOptions(m.item.defaultUnit);
      const p = parseQtyAndUnitAfterName(m.rest, opts);
      const qty = overrides.qty ?? p.qty;
      const unit = overrides.unit !== undefined ? overrides.unit : p.unit;
      const next = formatSupplyCatalogRequestLine(m.item.name, qty, unit);
      return replaceLineInMultilineText(prev, lineIndex, next);
    });
  };

  const patchFreeLine = (lineIndex: number, raw: string) => {
    const cleaned = raw.replace(/\r?\n/g, ' ');
    onChange((prev) => replaceLineInMultilineText(prev, lineIndex, cleaned));
  };

  const insertLineAfter = (lineIndex: number) => {
    onChange((prev) => {
      const arr = prev.split(/\r?\n/);
      arr.splice(lineIndex + 1, 0, '');
      return arr.join('\n');
    });
  };

  const isWholeEmpty = rawLines.length === 1 && rawLines[0] === '';

  const freePlaceholder = (index: number, line: string) => {
    if (line !== '') return undefined;
    if (isWholeEmpty && index === 0) return placeholder;
    return undefined;
  };

  return (
    <div
      id={id}
      role="group"
      aria-label={placeholder}
      className={cn(
        'flex min-h-[140px] w-full flex-col gap-1 rounded-md border border-input bg-input-fill px-3 py-2 text-sm',
        'ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
      )}
    >
      {rows.map(({ index, line }) => {
          const match = findCatalogMatchForLine(line, catalogItems);
          if (match) {
            const unitOpts = parseCatalogUnitOptions(match.item.defaultUnit);
            const parsed = parseQtyAndUnitAfterName(match.rest, unitOpts);
            return (
              <div
                key={`ln-${index}`}
                className="flex flex-nowrap items-center gap-2 border-b border-border/25 py-1.5 last:border-b-0 sm:gap-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-normal leading-none text-foreground">
                  {match.item.name}
                </span>
                <CatalogQtyInput
                  qty={parsed.qty}
                  ariaLabel={t('nomenclatureQtyAria', { name: match.item.name })}
                  onCommit={(n) => applyCatalogPatch(index, { qty: n })}
                />
                {unitOpts.length > 1 ? (
                  <select
                    aria-label={t('nomenclatureUnitAria')}
                    value={
                      unitOpts.includes(parsed.unit ?? '')
                        ? (parsed.unit ?? unitOpts[0]!)
                        : unitOpts[0]!
                    }
                    onChange={(e) => applyCatalogPatch(index, { unit: e.target.value })}
                    className={cn(
                      'box-border h-8 w-auto min-w-[3.5rem] max-w-[9rem] shrink-0 cursor-pointer rounded-md border border-border bg-background py-0 pl-2 pr-7 text-xs font-normal text-muted-foreground',
                      'outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {unitOpts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : unitOpts.length === 1 ? (
                  <span className="shrink-0 whitespace-nowrap text-sm font-normal leading-none text-muted-foreground">
                    {unitOpts[0]}
                  </span>
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground/80">{t('nomenclatureNoUnit')}</span>
                )}
              </div>
            );
          }

          const showPulseCaret = line === '' && focusedFreeIndex !== index;

          return (
            <div key={`ln-${index}`} className="group/line relative border-b border-border/25 pb-2 last:border-b-0 last:pb-0">
              {showPulseCaret ? (
                <span
                  className="pointer-events-none absolute left-0 top-[11px] z-0 inline-block h-[1.05rem] w-0.5 animate-pulse rounded-[1px] bg-primary/80 motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              <textarea
                rows={line === '' ? 1 : 2}
                value={line}
                placeholder={freePlaceholder(index, line)}
                onChange={(e) => patchFreeLine(index, e.target.value)}
                onFocus={() => setFocusedFreeIndex(index)}
                onBlur={() => setFocusedFreeIndex((cur) => (cur === index ? null : cur))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return;
                  e.preventDefault();
                  insertLineAfter(index);
                }}
                className={cn(
                  'relative z-[1] w-full resize-y rounded-none border-0 bg-transparent py-1 pl-2 text-sm leading-relaxed text-foreground shadow-none',
                  'caret-primary placeholder:text-muted-foreground focus-visible:outline-none',
                  'min-h-[2rem]',
                )}
              />
            </div>
          );
        })}
    </div>
  );
}
