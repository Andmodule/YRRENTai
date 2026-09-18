'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useIcalSyncProperty,
  useZodomusBindMapping,
  useZodomusImportSummary,
  useZodomusQueueSync,
  useZodomusRefreshStatus,
} from '@/hooks/use-property-integrations';
import { ZodomusStatusBadge } from '@/components/property/zodomus-status-badge';
import type { ZodomusPropertyStatus } from '@rentai/shared';
import { isAxiosError } from 'axios';

function buildPublicIcsUrl(propertyId: string): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin.replace(/\/$/, '');
  return `${origin}/api/v1/ical/export/${encodeURIComponent(propertyId)}.ics`;
}

interface PropertyIntegrationsCardProps {
  propertyId: string;
  /** When set, Zodomus “import summary” is available. */
  zodomusPropertyId?: string | null;
  zodomusStatus?: ZodomusPropertyStatus | null;
  zodomusStatusDetail?: string | null;
  /** Per-channel external ids (preferred over legacy single fields). */
  channelListings?: Array<{ externalListingId: string; otaPlatform?: { zodomusChannelId: number } | null }>;
  /** From property.otaPlatform — default channel for Zodomus import. */
  otaPlatform?: { zodomusChannelId: number } | null;
  /** Refresh property + calendar after sync (e.g. SWR mutate). */
  onSynced?: () => void | Promise<void>;
}

export function PropertyIntegrationsCard({
  propertyId,
  zodomusPropertyId,
  zodomusStatus,
  zodomusStatusDetail,
  channelListings,
  otaPlatform,
  onSynced,
}: PropertyIntegrationsCardProps) {
  const t = useTranslations('properties.integrations');
  const icsUrl = useMemo(() => buildPublicIcsUrl(propertyId), [propertyId]);
  const [channelId, setChannelId] = useState('1');
  const [forceQueueSync, setForceQueueSync] = useState(false);

  useEffect(() => {
    if (otaPlatform?.zodomusChannelId != null) {
      setChannelId(String(otaPlatform.zodomusChannelId));
    }
  }, [otaPlatform?.zodomusChannelId]);
  const icalSync = useIcalSyncProperty();
  const zImport = useZodomusImportSummary();
  const zQueue = useZodomusQueueSync();
  const zRefresh = useZodomusRefreshStatus();
  const zBind = useZodomusBindMapping();
  const hasZodomus =
    Boolean(zodomusPropertyId?.trim()) ||
    Boolean(channelListings?.some((c) => c.externalListingId?.trim()));

  async function copyIcs() {
    try {
      await navigator.clipboard.writeText(icsUrl);
      toast.success(t('exportCopied'));
    } catch {
      toast.error(t('exportCopyFailed'));
    }
  }

  async function runFullMapping() {
    const ch = Number(channelId);
    if (!Number.isFinite(ch) || ch < 1) {
      toast.error(t('channelInvalid'));
      return;
    }
    try {
      const d = await zBind.mutateAsync({ propertyId, channelId: ch, remap: true });
      const failed = d.steps.filter((s) => !s.ok).map((s) => s.step);
      if (failed.length > 0) {
        toast.warning(t('zodomusBindPartial', { steps: failed.join(', '), status: d.zodomusStatus ?? '—' }));
      } else {
        toast.success(t('zodomusBindOk', { status: d.zodomusStatus ?? '—' }));
      }
      await onSynced?.();
    } catch (e) {
      const msg = isAxiosError(e)
        ? String(
            (e.response?.data as { message?: string | { message?: string } } | undefined)?.message ??
              e.message,
          )
        : t('zodomusBindError');
      toast.error(typeof msg === 'string' ? msg : t('zodomusBindError'));
      console.error(e);
    }
  }

  async function runIcalSync() {
    try {
      const data = await icalSync.mutateAsync(propertyId);
      const results = data?.results ?? [];
      const imported = results.reduce((a, r) => a + r.imported, 0);
      const updated = results.reduce((a, r) => a + r.updated, 0);
      const failed = results.reduce((a, r) => a + r.failed, 0);
      toast.success(t('icalSyncToast', { imported, updated, failed }));
      await onSynced?.();
    } catch (e) {
      toast.error(t('icalSyncError'));
      console.error(e);
    }
  }

  async function runZodomusImport() {
    const ch = Number(channelId);
    if (!Number.isFinite(ch) || ch < 1) {
      toast.error(t('channelInvalid'));
      return;
    }
    try {
      const d = await zImport.mutateAsync({ propertyId, channelId: ch });
      toast.success(t('zodomusImportToast', { imported: d.imported, failed: d.failed }));
      await onSynced?.();
    } catch (e) {
      toast.error(t('zodomusImportError'));
      console.error(e);
    }
  }

  async function runZodomusQueueSync() {
    const ch = Number(channelId);
    if (!Number.isFinite(ch) || ch < 1) {
      toast.error(t('channelInvalid'));
      return;
    }
    try {
      const d = await zQueue.mutateAsync({ propertyId, channelId: ch, force: forceQueueSync });
      if (d.processed === 0 && d.skipped === 0 && d.failed === 0) {
        toast.message(t('zodomusQueueEmpty'));
      } else if (d.processed === 0 && d.skipped > 0 && d.failed === 0) {
        toast.success(t('zodomusQueueAllSkipped', { skipped: d.skipped }));
      } else if (d.failed > 0) {
        toast.warning(t('zodomusQueueToast', { processed: d.processed, skipped: d.skipped, failed: d.failed }));
      } else {
        toast.success(t('zodomusQueueToast', { processed: d.processed, skipped: d.skipped, failed: d.failed }));
      }
      await onSynced?.();
    } catch (e) {
      toast.error(t('zodomusQueueError'));
      console.error(e);
    }
  }

  async function runZodomusStatusRefresh() {
    const ch = Number(channelId);
    if (!Number.isFinite(ch) || ch < 1) {
      toast.error(t('channelInvalid'));
      return;
    }
    try {
      await zRefresh.mutateAsync({ propertyId, channelId: ch });
      toast.success(t('zodomusStatusRefreshed'));
      await onSynced?.();
    } catch (e) {
      toast.error(t('zodomusStatusRefreshError'));
      console.error(e);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">{t('title')}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('subtitle')}</p>

      <div className="mb-5 space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-3">
        <p className="text-xs font-medium text-foreground">{t('howItWorksTitle')}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('howItWorksLead')}</p>
        <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>{t('howItWorksInbound')}</li>
          <li>{t('howItWorksOutbound')}</li>
          <li>{t('howItWorksDirectCancel')}</li>
          <li>{t('howItWorksOtaCancel')}</li>
          <li>{t('howItWorksImportVsQueue')}</li>
        </ul>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-xs">{t('exportLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('exportHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 break-all rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
              {icsUrl || '…'}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyIcs()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {t('copy')}
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label className="text-xs">{t('icalSyncLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('icalSyncHint')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={icalSync.isPending}
            onClick={() => void runIcalSync()}
          >
            {icalSync.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t('icalSyncButton')}
          </Button>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <Label className="text-xs">{t('zodomusBindLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('zodomusBindHint')}</p>
          <Button
            type="button"
            size="sm"
            disabled={!hasZodomus || zBind.isPending}
            onClick={() => void runFullMapping()}
            title={!hasZodomus ? t('zodomusImportDisabledHint') : undefined}
          >
            {zBind.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t('zodomusBindButton')}
          </Button>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <Label className="text-xs">{t('zodomusStatusLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('zodomusStatusHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <ZodomusStatusBadge
              linked={hasZodomus}
              status={zodomusStatus}
              detail={zodomusStatusDetail}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasZodomus || zRefresh.isPending}
              onClick={() => void runZodomusStatusRefresh()}
              title={!hasZodomus ? t('zodomusImportDisabledHint') : undefined}
            >
              {zRefresh.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t('zodomusStatusRefresh')}
            </Button>
          </div>
          {zodomusStatusDetail?.trim() ? (
            <p className="text-[11px] leading-snug text-muted-foreground">{zodomusStatusDetail}</p>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <Label className="text-xs">{t('zodomusImportLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('zodomusImportHint')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="z-ch" className="text-[10px] text-muted-foreground">
                {t('channelId')}
              </Label>
              <Input
                id="z-ch"
                type="number"
                min={1}
                className="h-8 w-20 tabular-nums"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={!hasZodomus || zImport.isPending || zQueue.isPending}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!hasZodomus || zImport.isPending || zQueue.isPending}
              onClick={() => void runZodomusImport()}
              title={!hasZodomus ? t('zodomusImportDisabledHint') : undefined}
            >
              {zImport.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t('zodomusImportButton')}
            </Button>
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <Label className="text-xs">{t('zodomusQueueLabel')}</Label>
          <p className="text-[11px] text-muted-foreground">{t('zodomusQueueHint')}</p>
          <p className="text-[10px] text-muted-foreground">{t('zodomusQueueChannelHint')}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-2">
              <Checkbox
                id="z-queue-force"
                checked={forceQueueSync}
                onCheckedChange={(v) => setForceQueueSync(v === true)}
                disabled={!hasZodomus || zQueue.isPending}
                className="h-4 w-4"
              />
              <Label htmlFor="z-queue-force" className="cursor-pointer text-[11px] font-normal leading-snug text-muted-foreground">
                {t('zodomusQueueForce')}
              </Label>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!hasZodomus || zQueue.isPending || zImport.isPending}
              onClick={() => void runZodomusQueueSync()}
              title={!hasZodomus ? t('zodomusImportDisabledHint') : undefined}
            >
              {zQueue.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t('zodomusQueueButton')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
