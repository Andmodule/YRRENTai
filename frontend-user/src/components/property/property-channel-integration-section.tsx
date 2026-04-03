'use client';

import { useEffect, useState } from 'react';
import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BedDouble,
  Building2,
  CalendarRange,
  ChevronRight,
  Download,
  Home,
  Link2Off,
  Loader2,
  Plug2,
  Radio,
} from 'lucide-react';
import type { z } from 'zod';
import type { createPropertySchema } from '@rentai/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOtaPlatforms } from '@/hooks/use-ota-platforms';
import type { ZodomusPropertyPreview } from '@/hooks/use-zodomus-property-preview';
import { useZodomusPropertyPreview } from '@/hooks/use-zodomus-property-preview';
import { ZodomusRoomRatesPanel } from './zodomus-room-rates-panel';

type FormInput = z.input<typeof createPropertySchema>;

type PreviewRoom = ZodomusPropertyPreview['rooms'][number];

function extractAxiosErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>;
      const m = d.message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ');
      if (m && typeof m === 'object' && m !== null && 'message' in m) {
        const inner = (m as { message?: unknown }).message;
        if (typeof inner === 'string') return inner;
      }
      if (typeof d.detail === 'string') return d.detail;
    }
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

interface PropertyChannelIntegrationSectionProps {
  register: UseFormRegister<FormInput>;
  control: Control<FormInput>;
  errors: FieldErrors<FormInput>;
  watch: UseFormWatch<FormInput>;
  setValue: UseFormSetValue<FormInput>;
  icalLines: string;
  onIcalLinesChange: (value: string) => void;
  /** When editing an existing property, show step 2 immediately. */
  expandSyncDetailsInitially?: boolean;
}

function platformIcon(code: string) {
  const cls = 'h-5 w-5 shrink-0 sm:h-6 sm:w-6';
  if (code === 'airbnb') return <Home className={cls} aria-hidden />;
  if (code === 'booking') return <Building2 className={cls} aria-hidden />;
  return null;
}

function StepPill({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-[2rem] items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide transition-colors sm:text-xs',
        active
          ? 'border-primary/50 bg-primary/12 text-primary ring-1 ring-primary/20'
          : done
            ? 'border-border/60 bg-muted/50 text-muted-foreground'
            : 'border-border/50 bg-muted/30 text-muted-foreground',
      )}
    >
      {done && !active ? (
        <span className="text-[10px] text-primary" aria-hidden>
          ✓
        </span>
      ) : (
        <Radio
          className={cn('h-3 w-3 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

export function PropertyChannelIntegrationSection({
  register,
  control,
  errors,
  watch,
  setValue,
  icalLines,
  onIcalLinesChange,
  expandSyncDetailsInitially = false,
}: PropertyChannelIntegrationSectionProps) {
  const t = useTranslations('properties.form');
  const { platforms, isLoading } = useOtaPlatforms();
  const previewMutation = useZodomusPropertyPreview();
  const selectedId = watch('otaPlatformId');
  const zodomusExternalId = watch('zodomusPropertyId');
  const selectedPlatform = platforms.find((p) => p.id === selectedId);
  const selectedCode = selectedPlatform?.code;
  const channelId = selectedPlatform?.zodomusChannelId;
  const hasOtaZodomus = Boolean(channelId);
  const zodomusRoomIdValue = watch('zodomusRoomId');

  const [syncPanelOpen, setSyncPanelOpen] = useState(() => expandSyncDetailsInitially);
  /** Rooms from last successful «Load»; cleared when channel or property id no longer matches. */
  const [loadResult, setLoadResult] = useState<{
    key: string;
    rooms: PreviewRoom[];
  } | null>(null);

  useEffect(() => {
    if (expandSyncDetailsInitially) setSyncPanelOpen(true);
  }, [expandSyncDetailsInitially]);

  const pickerKey =
    channelId != null ? `${channelId}:${String(zodomusExternalId ?? '').trim()}` : '';
  useEffect(() => {
    if (!loadResult) return;
    if (!pickerKey || loadResult.key !== pickerKey) {
      setLoadResult(null);
    }
  }, [pickerKey, loadResult]);

  async function loadFromZodomus() {
    const ext = String(zodomusExternalId ?? '').trim();
    if (!channelId) {
      toast.error(t('previewNeedPlatform'));
      return;
    }
    if (!ext) {
      toast.error(t('previewNeedId'));
      return;
    }
    try {
      const p = await previewMutation.mutateAsync({ channelId, externalPropertyId: ext });
      setValue('name', p.displayName, { shouldDirty: true, shouldValidate: true });
      setValue('country', p.country?.trim() ? p.country : '-', { shouldDirty: true, shouldValidate: true });
      setValue('city', p.city?.trim() ? p.city : '-', { shouldDirty: true, shouldValidate: true });
      setValue('address', p.address?.trim() ? p.address : '-', { shouldDirty: true, shouldValidate: true });
      setValue('zodomusPropertyId', p.externalPropertyId, { shouldDirty: true });
      const firstRoom = p.rooms[0];
      const roomId = firstRoom?.id ?? '';
      setValue('zodomusRoomId', roomId || null, { shouldDirty: true });
      setLoadResult({
        rooms: p.rooms,
        key: `${channelId}:${p.externalPropertyId.trim()}`,
      });
      toast.success(
        p.rooms.length > 1 ? t('previewToastRoomsLoaded', { count: p.rooms.length }) : t('previewToastOk'),
      );
    } catch (e: unknown) {
      const msg = extractAxiosErrorMessage(e);
      const lower = msg.toLowerCase();
      if (
        lower.includes('zodomus_invalid_property_id') ||
        lower.includes('invalid property id') ||
        (lower.includes('invalid property') &&
          (lower.includes('not the room') || lower.includes('room id')))
      ) {
        toast.error(t('previewToastInvalidPropertyId'));
      } else {
        toast.error(t('previewToastError', { message: msg }));
      }
    }
  }

  const zodomusHint =
    selectedCode === 'booking'
      ? t('zodomusPropertyIdHintBooking')
      : selectedCode === 'airbnb'
        ? t('zodomusPropertyIdHintAirbnb')
        : t('zodomusPropertyIdHint');

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-muted/35 via-background/80 to-background',
        'shadow-sm ring-1 ring-black/[0.04] dark:from-muted/15 dark:ring-white/[0.06]',
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent dark:from-primary/[0.09]"
        aria-hidden
      />

      <div className="relative space-y-4 p-4 sm:p-5">
        <header className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">{t('integrationsSection')}</p>
              <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">
                {syncPanelOpen ? t('channelPickerIntro') : t('syncFlowPickIntro')}
              </p>
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-3"
            aria-label={t('syncFlowAriaSteps')}
          >
            <StepPill label={t('syncFlowStep1')} active={!syncPanelOpen} done={syncPanelOpen} />
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
            <StepPill label={t('syncFlowStep2')} active={syncPanelOpen} done={false} />
          </div>
        </header>

        <Controller
          name="otaPlatformId"
          control={control}
          render={({ field }) => {
            const isUnset = field.value === undefined;
            const noneActive = field.value === null || field.value === '';

            const commitChannel = (next: string | null) => {
              field.onChange(next);
              setSyncPanelOpen(true);
            };

            return (
              <div className="space-y-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t('channelPickerLabel')}
                </span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => commitChannel(null)}
                    className={cn(
                      'flex min-h-[4.75rem] flex-col items-start justify-center gap-1 rounded-2xl border px-4 py-3.5 text-left transition-all',
                      'active:scale-[0.99] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      noneActive
                        ? 'border-primary/60 bg-primary/[0.08] ring-1 ring-inset ring-primary/25'
                        : isUnset
                          ? 'border-border/70 bg-background/60'
                          : 'border-border/60 bg-background/60',
                    )}
                  >
                    <Link2Off className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-semibold leading-tight">{t('channelNone')}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                      {t('channelNoneHint')}
                    </span>
                  </button>
                  {isLoading && (
                    <div className="col-span-full flex min-h-[4.75rem] items-center rounded-2xl border border-dashed border-border/60 px-4 py-4 text-xs text-muted-foreground sm:col-span-2">
                      {t('channelPickerLoading')}
                    </div>
                  )}
                  {!isLoading &&
                    platforms.map((p) => {
                      const active = field.value === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => commitChannel(p.id)}
                          className={cn(
                            'flex min-h-[4.75rem] flex-col items-start justify-center gap-1 rounded-2xl border px-4 py-3.5 text-left transition-all',
                            'active:scale-[0.99] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            active
                              ? 'border-primary/60 bg-primary/[0.08] ring-1 ring-inset ring-primary/25'
                              : 'border-border/60 bg-background/60',
                          )}
                        >
                          <span className="flex items-center gap-2">
                            {platformIcon(p.code)}
                            <span className="text-sm font-semibold leading-tight">
                              {p.code === 'booking'
                                ? t('platformName_booking')
                                : p.code === 'airbnb'
                                  ? t('platformName_airbnb')
                                  : p.code}
                            </span>
                          </span>
                          <span className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                            {p.code === 'booking'
                              ? t('platformBlurb_booking')
                              : p.code === 'airbnb'
                                ? t('platformBlurb_airbnb')
                                : ''}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          }}
        />

        <AnimatePresence initial={false}>
          {!syncPanelOpen && (
            <motion.div
              key="hint"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-3 py-3 text-center sm:px-4"
            >
              <p className="text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">
                {t('syncFlowUnlockHint')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {syncPanelOpen && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4 border-t border-border/50 pt-4"
            >
              {hasOtaZodomus && (
                <div className="space-y-3 rounded-xl border border-border/40 bg-muted/15 p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Plug2 className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {t('syncFlowZodomusBlockTitle')}
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="zodomusPropertyId" className="text-xs">
                        {t('zodomusPropertyId')}
                      </Label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <Input
                          id="zodomusPropertyId"
                          placeholder={t('zodomusPropertyIdPlaceholder')}
                          autoComplete="off"
                          className="min-h-11 min-w-0 flex-1 font-mono text-sm tabular-nums"
                          aria-invalid={!!errors.zodomusPropertyId}
                          aria-describedby="zodomus-hint"
                          {...register('zodomusPropertyId')}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="default"
                          className="h-11 w-full shrink-0 gap-2 sm:h-auto sm:w-auto sm:min-w-[11rem]"
                          disabled={
                            !channelId ||
                            !String(zodomusExternalId ?? '').trim() ||
                            previewMutation.isPending
                          }
                          onClick={() => void loadFromZodomus()}
                          title={!channelId ? t('previewNeedPlatform') : undefined}
                        >
                          {previewMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {t('previewLoadButton')}
                        </Button>
                      </div>
                      <p id="zodomus-hint" className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                        {zodomusHint}
                      </p>
                      <p className="text-[11px] leading-snug text-amber-600/90 dark:text-amber-400/90 sm:text-[12px]">
                        {t('zodomusPropertyIdHintLoad')}
                      </p>
                      <p className="text-[11px] leading-snug text-muted-foreground/90 sm:text-[12px]">
                        {t('zodomusPreviewNoAddressHint')}
                      </p>
                      {errors.zodomusPropertyId && (
                        <p className="text-xs text-destructive">{errors.zodomusPropertyId.message}</p>
                      )}
                    </div>

                    {loadResult && loadResult.rooms.length > 0 && pickerKey === loadResult.key && (
                      <div
                        className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3 sm:p-3.5"
                        role="group"
                        aria-label={t('previewRoomsTitle')}
                      >
                        <div className="flex items-start gap-2">
                          <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <div>
                            <p className="text-xs font-semibold text-foreground">{t('previewRoomsTitle')}</p>
                            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                              {loadResult.rooms.length > 1
                                ? t('previewRoomsSubtitle')
                                : t('previewRoomsSingle')}
                            </p>
                          </div>
                        </div>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {loadResult.rooms.map((room) => {
                            const selected =
                              String(zodomusRoomIdValue ?? '').trim() === String(room.id).trim();
                            const label = room.name?.trim() || room.id;
                            return (
                              <li key={room.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setValue('zodomusRoomId', room.id, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                  aria-pressed={selected}
                                  className={cn(
                                    'flex w-full min-h-[3.25rem] flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                                    'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    selected
                                      ? 'border-primary/60 bg-primary/[0.1] ring-1 ring-inset ring-primary/25'
                                      : 'border-border/70 bg-background/60',
                                  )}
                                >
                                  <span className="font-medium leading-tight text-foreground">{label}</span>
                                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground sm:text-xs">
                                    {room.id}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {loadResult && pickerKey === loadResult.key && (
                      <ZodomusRoomRatesPanel rooms={loadResult.rooms} className="mt-3" />
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="zodomusRoomId" className="text-xs">
                        {t('zodomusRoomId')}
                      </Label>
                      <Input
                        id="zodomusRoomId"
                        placeholder={t('zodomusRoomIdPlaceholder')}
                        autoComplete="off"
                        className="min-h-11 font-mono text-sm tabular-nums"
                        aria-invalid={!!errors.zodomusRoomId}
                        aria-describedby="zodomus-room-hint"
                        {...register('zodomusRoomId')}
                      />
                      <p id="zodomus-room-hint" className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                        {t('zodomusRoomIdHint')}
                      </p>
                      {errors.zodomusRoomId && (
                        <p className="text-xs text-destructive">{errors.zodomusRoomId.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!hasOtaZodomus && (
                <div className="rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5 sm:px-4">
                  <div className="flex items-start gap-2.5">
                    <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-[12px]">
                      {t('syncFlowNoOtaLead')}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="icalImportUrls" className="text-xs">
                  {t('icalImportUrls')}
                </Label>
                <p className="text-[11px] text-muted-foreground sm:text-[12px]">{t('icalBlockIntro')}</p>
                <Textarea
                  id="icalImportUrls"
                  rows={4}
                  placeholder={t('icalImportUrlsPlaceholder')}
                  className="min-h-[7rem] resize-y font-mono text-xs sm:text-sm"
                  value={icalLines}
                  onChange={(e) => onIcalLinesChange(e.target.value)}
                  aria-describedby="ical-hint"
                />
                <p id="ical-hint" className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                  {t('icalImportUrlsHint')}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
