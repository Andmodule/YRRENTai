'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-green-500' : 'bg-muted-foreground/40')}
      aria-hidden
    />
  );
}

function IntegrationCard({
  title,
  description,
  connected,
  onPrimary,
  primaryLabel,
  children,
}: {
  title: string;
  description: string;
  connected: boolean;
  onPrimary: () => void;
  primaryLabel: string;
  children?: React.ReactNode;
}) {
  const tc = useTranslations('settings.common');
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{title}</h3>
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <StatusDot connected={connected} />
              {connected ? tc('connected') : tc('disconnected')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant={connected ? 'outline' : 'default'} className="shrink-0" onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </div>
      {children ? <div className="mt-4 border-t border-border/60 pt-4">{children}</div> : null}
    </section>
  );
}

export function IntegrationsSettingsPage() {
  const t = useTranslations('settings.integrations');
  const tc = useTranslations('settings.common');

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      <div className="space-y-4">
        <IntegrationCard
          title={t('bookingTitle')}
          description={t('bookingSubtitle')}
          connected={false}
          primaryLabel={tc('connect')}
          onPrimary={() => {}}
        />
        <IntegrationCard
          title={t('airbnbTitle')}
          description={t('airbnbSubtitle')}
          connected={false}
          primaryLabel={tc('connect')}
          onPrimary={() => {}}
        />
        <IntegrationCard
          title={t('locksTitle')}
          description={t('locksSubtitle')}
          connected={false}
          primaryLabel={tc('configure')}
          onPrimary={() => {}}
        >
          <div className="space-y-1.5">
            <Label htmlFor="locks-api">API key</Label>
            <Input id="locks-api" placeholder="••••••••" disabled className="max-w-md" />
          </div>
        </IntegrationCard>
      </div>
    </div>
  );
}
