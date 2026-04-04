export type NormalizedRole = 'owner' | 'manager' | 'staff' | 'unknown';

export function normalizeRole(role: string | undefined): NormalizedRole {
  const r = (role ?? '').toLowerCase();
  if (r === 'owner') return 'owner';
  if (r === 'manager') return 'manager';
  if (r === 'staff') return 'staff';
  return 'unknown';
}

/** Manager cannot open these path segments under /settings (redirect to profile). */
export const SETTINGS_OWNER_ONLY_SEGMENTS = ['integrations', 'billing', 'team', 'inbound-email'] as const;
