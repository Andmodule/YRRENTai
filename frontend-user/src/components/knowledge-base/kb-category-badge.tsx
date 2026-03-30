import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { KbCategory } from '@/types';

const CATEGORY_STYLES: Record<KbCategory, string> = {
  checkin: 'bg-yellow-50 text-yellow-800',
  wifi: 'bg-purple-50 text-purple-700',
  rules: 'bg-orange-50 text-orange-700',
  location: 'bg-green-50 text-green-700',
  neighborhood: 'bg-emerald-50 text-emerald-800',
  parking: 'bg-indigo-50 text-indigo-800',
  equipment: 'bg-blue-50 text-blue-700',
  services: 'bg-teal-50 text-teal-700',
  contacts: 'bg-pink-50 text-pink-700',
  safety: 'bg-red-50 text-red-800',
  waste: 'bg-amber-50 text-amber-800',
  pets: 'bg-rose-50 text-rose-800',
  family: 'bg-sky-50 text-sky-800',
  quiet: 'bg-violet-50 text-violet-800',
  other: 'bg-gray-100 text-gray-600',
};

const CATEGORY_ICONS: Record<KbCategory, string> = {
  checkin: '🔑',
  wifi: '📡',
  rules: '📋',
  location: '📍',
  neighborhood: '🏘️',
  parking: '🅿️',
  equipment: '🔧',
  services: '🛎',
  contacts: '📞',
  safety: '🛡️',
  waste: '🗑️',
  pets: '🐾',
  family: '👶',
  quiet: '🤫',
  other: '📝',
};

interface KbCategoryBadgeProps {
  category?: string;
  className?: string;
}

export function KbCategoryBadge({ category, className }: KbCategoryBadgeProps) {
  const t = useTranslations('kb.categories');
  const cat = (category ?? 'other') as KbCategory;
  const style = CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.other;
  const icon = CATEGORY_ICONS[cat] ?? CATEGORY_ICONS.other;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        style,
        className,
      )}
    >
      <span>{icon}</span>
      <span>{t(cat)}</span>
    </span>
  );
}

export { CATEGORY_ICONS, CATEGORY_STYLES };

/** Display order: common guest topics first, `other` last */
export const KB_CATEGORIES: KbCategory[] = [
  'checkin',
  'wifi',
  'rules',
  'location',
  'neighborhood',
  'parking',
  'equipment',
  'services',
  'contacts',
  'safety',
  'waste',
  'pets',
  'family',
  'quiet',
  'other',
];

/** How many category chips to show before "More" in empty/add rows */
export const KB_CATEGORY_CHIPS_INITIAL = 5;
