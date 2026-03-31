'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { ConfirmDestructiveDialog } from '@/components/settings/confirm-destructive-dialog';

export function SecuritySettingsPage() {
  const t = useTranslations('settings.security');
  const tc = useTranslations('settings.common');
  const [twoFA, setTwoFA] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const sessions = [
    { id: '1', labelKey: 'sessionThis' as const },
    { id: '2', labelKey: 'sessionOther' as const },
  ];

  function handlePasswordSave() {
    toast.info(tc('saveNotReady'));
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      <SettingsSectionCard title={t('passwordCard')} description={t('passwordHint')}>
        <div className="grid max-w-xl gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw-cur">{t('currentPassword')}</Label>
            <Input id="pw-cur" type="password" autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">{t('newPassword')}</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">{t('confirmPassword')}</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" />
          </div>
        </div>
        <Button type="button" onClick={handlePasswordSave}>
          {tc('saveChanges')}
        </Button>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('sessionsCard')} description={t('sessionsHint')}>
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border border-border/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium">{t(s.labelKey)}</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => setRevokeOpen(true)}
              >
                {t('revokeSession')}
              </Button>
            </li>
          ))}
        </ul>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('twoFactorCard')} description={t('twoFactorHint')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Label htmlFor="twofa" className="cursor-pointer text-sm font-medium">
            {t('twoFactorLabel')}
          </Label>
          <Switch id="twofa" checked={twoFA} onCheckedChange={setTwoFA} />
        </div>
        {twoFA ? (
          <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            {t('twoFactorQrPlaceholder')}
          </div>
        ) : null}
      </SettingsSectionCard>

      <ConfirmDestructiveDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t('revokeConfirmTitle')}
        description={t('revokeConfirmDescription')}
        confirmLabel={t('revokeSession')}
        onConfirm={() => toast.info(tc('saveNotReady'))}
      />
    </div>
  );
}
