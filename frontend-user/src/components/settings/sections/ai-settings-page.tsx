'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient } from '@/lib/api/client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';

export function AiSettingsPage() {
  const t = useTranslations('settings.ai');
  const [language, setLanguage] = useState('auto');
  const [tone, setTone] = useState('neutral');
  const [name, setName] = useState('Анна');
  const [autoReply, setAutoReply] = useState(true);
  const [delaySec, setDelaySec] = useState([3]);
  const [requiresApproval, setRequiresApproval] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ data: { requiresApproval: boolean } }>('/chats/ai-reply-settings')
      .then((res) => setRequiresApproval(!!res.data.data?.requiresApproval))
      .catch(() => setRequiresApproval(false));
  }, []);

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      {requiresApproval && (
        <Alert className="border-amber-400/50 bg-amber-50/80 dark:border-amber-600/40 dark:bg-amber-950/25">
          <AlertDescription className="text-sm">{t('requiresApprovalBanner')}</AlertDescription>
        </Alert>
      )}

      <SettingsSectionCard title={t('languageCard')}>
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-lang">{t('defaultLanguage')}</Label>
            <Select id="ai-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="ru">{t('langRu')}</option>
              <option value="en">{t('langEn')}</option>
              <option value="auto">{t('langAuto')}</option>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-tone">{t('tone')}</Label>
            <Select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="formal">{t('toneFormal')}</option>
              <option value="friendly">{t('toneFriendly')}</option>
              <option value="neutral">{t('toneNeutral')}</option>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-name">{t('assistantName')}</Label>
            <Input
              id="ai-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('assistantNamePlaceholder')}
            />
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('autoReplyCard')} description={t('autoReplyHint')}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ai-auto" className="cursor-pointer text-sm font-normal">
            {t('autoReplyLabel')}
          </Label>
          <Switch id="ai-auto" checked={autoReply} onCheckedChange={setAutoReply} />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('typingDelayCard')} description={t('typingDelayHint')}>
        <div className="space-y-3">
          <div className="flex justify-between gap-2 text-sm text-muted-foreground">
            <span>0</span>
            <span className="tabular-nums">{t('typingDelayValue', { seconds: delaySec[0] ?? 0 })}</span>
            <span>30</span>
          </div>
          <Slider min={0} max={30} step={1} value={delaySec} onValueChange={setDelaySec} className="max-w-md" />
        </div>
      </SettingsSectionCard>
    </div>
  );
}
