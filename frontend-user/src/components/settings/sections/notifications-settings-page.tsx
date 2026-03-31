'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { TelegramNotificationsCard } from '@/components/settings/telegram-notifications-card';

export function NotificationsSettingsPage() {
  const t = useTranslations('settings.notifications');
  const [emailBooking, setEmailBooking] = useState(false);
  const [emailCheckout, setEmailCheckout] = useState(true);
  const [emailHouse, setEmailHouse] = useState(true);
  const [confidence, setConfidence] = useState([70]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      <TelegramNotificationsCard />

      <SettingsSectionCard title={t('emailCard')} description={t('emailHint')}>
        <div className="mb-2">
          <Badge variant="outline" className="font-mono text-[10px] uppercase text-amber-500">
            dev
          </Badge>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="em-b" className="cursor-pointer text-sm font-normal">
              {t('emailNewBooking')}
            </Label>
            <Switch id="em-b" checked={emailBooking} onCheckedChange={setEmailBooking} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="em-c" className="cursor-pointer text-sm font-normal">
              {t('emailCheckout')}
            </Label>
            <Switch id="em-c" checked={emailCheckout} onCheckedChange={setEmailCheckout} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="em-h" className="cursor-pointer text-sm font-normal">
              {t('emailHousekeeping')}
            </Label>
            <Switch id="em-h" checked={emailHouse} onCheckedChange={setEmailHouse} />
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('escalationCard')} description={t('escalationHint')}>
        <div className="mb-2">
          <Badge variant="outline" className="font-mono text-[10px] uppercase text-amber-500">
            dev
          </Badge>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-normal">{t('escalationThreshold')}</Label>
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('escalationValue', { value: confidence[0] ?? 70 })}
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={confidence}
            onValueChange={setConfidence}
            className="max-w-md"
          />
        </div>
      </SettingsSectionCard>
    </div>
  );
}
