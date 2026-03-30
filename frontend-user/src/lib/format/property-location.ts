import type { Property } from '@/types';

/** Страна, город и полный адрес в одну строку (для списков и карточек). */
export function formatPropertyLocation(p: Property): string {
  const part = (s: string | undefined) => (s && s !== '-' ? s.trim() : '');
  return [part(p.country), part(p.city), part(p.address)].filter(Boolean).join(', ');
}
