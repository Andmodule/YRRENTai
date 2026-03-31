import type { LucideIcon } from 'lucide-react';
import { User, Shield, Bell, Plug, Bot, CreditCard, Users, ListChecks } from 'lucide-react';

export type SettingsNavId =
  | 'profile'
  | 'security'
  | 'notifications'
  | 'checklistTemplates'
  | 'integrations'
  | 'ai'
  | 'billing'
  | 'team';

export interface SettingsNavItem {
  id: SettingsNavId;
  href: string;
  messageKey: string;
  icon: LucideIcon;
  /** Show "dev" badge next to the nav label — section not fully shipped. */
  dev: boolean;
  /** If true, only owner sees this item (manager hidden). */
  ownerOnly: boolean;
}

export const settingsNavItems: SettingsNavItem[] = [
  {
    id: 'profile',
    href: '/settings/profile',
    messageKey: 'nav.profile',
    icon: User,
    dev: true,
    ownerOnly: false,
  },
  {
    id: 'security',
    href: '/settings/security',
    messageKey: 'nav.security',
    icon: Shield,
    dev: true,
    ownerOnly: false,
  },
  {
    id: 'notifications',
    href: '/settings/notifications',
    messageKey: 'nav.notifications',
    icon: Bell,
    dev: false,
    ownerOnly: false,
  },
  {
    id: 'checklistTemplates',
    href: '/settings/checklist-templates',
    messageKey: 'nav.checklistTemplates',
    icon: ListChecks,
    dev: false,
    ownerOnly: false,
  },
  {
    id: 'integrations',
    href: '/settings/integrations',
    messageKey: 'nav.integrations',
    icon: Plug,
    dev: true,
    ownerOnly: true,
  },
  {
    id: 'ai',
    href: '/settings/ai',
    messageKey: 'nav.ai',
    icon: Bot,
    dev: true,
    ownerOnly: false,
  },
  {
    id: 'billing',
    href: '/settings/billing',
    messageKey: 'nav.billing',
    icon: CreditCard,
    dev: true,
    ownerOnly: true,
  },
  {
    id: 'team',
    href: '/settings/team',
    messageKey: 'nav.team',
    icon: Users,
    dev: true,
    ownerOnly: true,
  },
];

export function filterNavItemsForRole(
  role: 'owner' | 'manager',
  items: SettingsNavItem[] = settingsNavItems,
): SettingsNavItem[] {
  return items.filter((item) => (item.ownerOnly ? role === 'owner' : true));
}
