/**
 * "FirstName LastName" → "FirstName L." (полное имя + первая буква фамилии с точкой).
 */
export function formatNameAndLastInitial(name: string | null | undefined): string {
  if (!name?.trim()) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]!;
    const lastInitial = parts[parts.length - 1]![0];
    if (lastInitial) return `${first} ${lastInitial.toUpperCase()}.`;
    return first;
  }
  return parts[0] ?? '';
}
