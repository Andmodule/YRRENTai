'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { Skeleton } from '@/components/ui/skeleton';

export function ProfileSettingsPage() {
  const t = useTranslations('settings.profile');
  const tc = useTranslations('settings.common');
  const { user, isLoading } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setPhone(user.phone ?? '');
  }, [user]);

  function handleSave() {
    toast.info(tc('saveNotReady'));
  }

  function handleAvatar() {
    toast.info(tc('saveNotReady'));
  }

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      <SettingsSectionCard title={t('personalCard')} description={t('personalCardHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sf-name">{t('firstName')}</Label>
            <Input id="sf-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-last">{t('lastName')}</Label>
            <Input id="sf-last" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sf-email">{t('email')}</Label>
            <p className="text-xs text-muted-foreground">{t('emailReadOnlyHint')}</p>
            <Input id="sf-email" value={user.email} readOnly className="cursor-not-allowed opacity-90" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sf-phone">{t('phone')}</Label>
            <Input
              id="sf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              type="tel"
            />
          </div>
        </div>
        <Button type="button" onClick={handleSave}>
          {tc('saveChanges')}
        </Button>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('avatarCard')} description={t('avatarHint')}>
        <Button type="button" variant="outline" onClick={handleAvatar} disabled>
          {t('uploadAvatar')}
        </Button>
      </SettingsSectionCard>
    </div>
  );
}
