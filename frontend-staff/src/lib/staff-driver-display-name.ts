import type { StaffUser } from '@/hooks/use-auth';

/** «Иван П.» — имя и первая буква фамилии для шапки водителя. */
export function staffDriverShortLabel(user: StaffUser | undefined | null): string | null {
  if (!user) return null;
  const f = user.firstName?.trim() || '';
  const l = user.lastName?.trim() || '';
  if (!f && !l) return null;
  const initial = l ? `${l.slice(0, 1).toUpperCase()}.` : '';
  return [f, initial].filter(Boolean).join(' ');
}
