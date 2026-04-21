'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';

type InboundFilterDto = {
  allowedHosts: string[];
  allowGmailGooglemail: boolean;
  updatedAt: string;
};

export function InboundSenderFilterSettingsPage() {
  const t = useTranslations('settings.inboundSenderFilter');
  const tc = useTranslations('settings.common');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hostsText, setHostsText] = useState('');
  const [allowGmail, setAllowGmail] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get<InboundFilterDto>('/settings/inbound-sender-filter');
      setHostsText(data.allowedHosts.join('\n'));
      setAllowGmail(data.allowGmailGooglemail);
      setUpdatedAt(data.updatedAt);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    const allowedHosts = hostsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const { data } = await apiClient.patch<InboundFilterDto>('/settings/inbound-sender-filter', {
        allowedHosts,
        allowGmailGooglemail: allowGmail,
      });
      setHostsText(data.allowedHosts.join('\n'));
      setAllowGmail(data.allowGmailGooglemail);
      setUpdatedAt(data.updatedAt);
      toast.success(t('saveSuccess'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('loading')}
        </div>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inbound-hosts">{t('allowedHostsLabel')}</Label>
                <p className="text-sm text-muted-foreground">{t('allowedHostsHint')}</p>
                <textarea
                  id="inbound-hosts"
                  className="min-h-[140px] w-full max-w-2xl rounded-md border border-input bg-input-fill px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={hostsText}
                  onChange={(e) => setHostsText(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              <div className="flex items-start gap-3">
                <input
                  id="inbound-gmail"
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input"
                  checked={allowGmail}
                  onChange={(e) => setAllowGmail(e.target.checked)}
                />
                <div className="space-y-1">
                  <Label htmlFor="inbound-gmail" className="cursor-pointer font-medium">
                    {t('allowGmailLabel')}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t('allowGmailHint')}</p>
                </div>
              </div>

              {updatedAt ? (
                <p className="text-xs text-muted-foreground">
                  {t('updatedAt', { at: new Date(updatedAt).toLocaleString() })}
                </p>
              ) : null}
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {tc('saveChanges')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={saving || loading}>
              {t('reload')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
