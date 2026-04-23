/** Разбивает поле справочника «единица»: несколько вариантов через «|», например `шт|упак.` */
export function parseCatalogUnitOptions(defaultUnit: string | null | undefined): string[] {
  const s = defaultUnit?.trim();
  if (!s) return [];
  if (s.includes('|')) {
    return s
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [s];
}

export type SupplyCatalogLite = { id: string; name: string; defaultUnit: string | null };

/** Строка для текстового запроса довоза: название из справочника + количество + выбранная единица */
export function formatSupplyCatalogRequestLine(name: string, qty: number, unit: string | null): string {
  const n = name.trim().slice(0, 500);
  const q =
    Number.isFinite(qty) && qty > 0 ? Math.min(Math.floor(Number(qty)), 999999) : 1;
  const u = unit?.trim().slice(0, 64) ?? '';
  const core = u ? `${n} ${q} ${u}` : `${n} ${q}`;
  return core.slice(0, 500);
}

export function parsePositiveIntQty(raw: string): number {
  const t = raw.replace(/\s/g, '').replace(/^0+/, '');
  const n = parseInt(t || '1', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 999999);
}

/** Совпадение по началу строки: точное имя или «имя + пробел + …». Длинные имена проверяются первыми. */
export function findCatalogMatchForLine(line: string, items: SupplyCatalogLite[]): { item: SupplyCatalogLite; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const sorted = [...items].sort(
    (a, b) => b.name.trim().length - a.name.trim().length || a.name.localeCompare(b.name),
  );
  for (const item of sorted) {
    const nm = item.name.trim();
    if (!nm) continue;
    if (trimmed === nm) return { item, rest: '' };
    if (trimmed.startsWith(nm + ' ') || trimmed.startsWith(nm + '\t')) {
      return { item, rest: trimmed.slice(nm.length).trim() };
    }
  }
  return null;
}

/** Остаток строки после канонического имени: количество и единица */
export function parseQtyAndUnitAfterName(rest: string, unitOptions: string[]): { qty: number; unit: string | null } {
  const opts = unitOptions.filter(Boolean);
  const r = rest.trim();
  if (!r) {
    return { qty: 1, unit: opts[0] ?? null };
  }
  const numMatch = /^(\d+)(?:\s+([\s\S]*))?$/.exec(r);
  if (numMatch?.[1]) {
    const rawQ = parseInt(numMatch[1], 10);
    const q = Number.isFinite(rawQ) && rawQ > 0 ? Math.min(rawQ, 999999) : 1;
    const tail = (numMatch[2] ?? '').trim();
    if (!tail) return { qty: q, unit: opts[0] ?? null };
    const pick =
      opts.find((o) => tail === o || tail.startsWith(o)) ?? tail.split(/\s+/)[0]?.slice(0, 64) ?? opts[0] ?? null;
    return { qty: q, unit: pick };
  }
  const matchedOpt = opts.find((o) => r === o || r.startsWith(o));
  return { qty: 1, unit: matchedOpt ?? r.slice(0, 64) ?? opts[0] ?? null };
}

export function replaceLineInMultilineText(text: string, lineIndex: number, newLine: string): string {
  const lines = text.split(/\r?\n/);
  while (lines.length <= lineIndex) lines.push('');
  lines[lineIndex] = newLine;
  return lines.join('\n');
}
