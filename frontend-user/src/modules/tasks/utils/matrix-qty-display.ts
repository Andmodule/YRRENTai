/**
 * Убирает типичный хвост числа и единицы справа (несколько проходов — случаи вроде « … 7 1»).
 * Для заголовка номенклатуры из полной строки заявки.
 */
export function stripTrailingQtyFromMatrixTitle(name: string): string {
  let s = name.trimEnd();
  const re = /\s+\d+(?:\s+[^\r\n\d][^\r\n]*)?$/u;
  for (let i = 0; i < 8; i++) {
    const next = s.replace(re, '').trimEnd();
    if (next === s || next.length < 1) break;
    s = next;
  }
  return s.length >= 1 ? s : name.trimEnd();
}

/**
 * Если в подписи строки уже есть то же количество/единица, что и в сером хвосте — не дублировать.
 * Сырое `name` из заявки часто совпадает с полной строкой («Бумажные салфетки 1 упак.»).
 */
export function matrixQtySuffixRedundant(
  displayName: string,
  qtyLabel: string | null | undefined,
  depth = 0,
): boolean {
  if (qtyLabel == null || qtyLabel === '') return false;
  const q = qtyLabel.trim();
  if (!q) return false;
  const name = displayName.trimEnd();
  if (name.endsWith(q)) return true;

  const m = /^(\d+)(?:\s+(.*))?$/u.exec(q);
  if (!m) return false;
  const digits = m[1];
  const tail = (m[2] ?? '').trim();
  if (tail) {
    const suffix = `${digits} ${tail}`.replace(/\s+/g, ' ');
    if (name.endsWith(suffix)) return true;
  } else {
    const endNum = /(?:^|\s)(\d+)$/.exec(name);
    if (endNum != null && endNum[1] === digits) return true;
  }

  if (depth < 6) {
    const stripped = stripTrailingQtyFromMatrixTitle(displayName);
    if (stripped !== displayName.trimEnd()) {
      return matrixQtySuffixRedundant(stripped, qtyLabel, depth + 1);
    }
  }
  return false;
}
