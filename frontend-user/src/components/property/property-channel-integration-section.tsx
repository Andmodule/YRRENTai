'use client';

import { useEffect, useState } from 'react';
import type {
  Control,
  FieldErrors,
  UseFieldArrayReturn,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import { Controller, useFieldArray } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BedDouble,
  Building2,
  Download,
  Home,
  Loader2,
  Plug2,
  Plus,
  Trash2,
} from 'lucide-react';
import type { z } from 'zod';
import type { createPropertySchema } from '@rentai/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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
}

function platformIcon(code: string) {
  const cls = 'h-4 w-4 shrink-0';
  if (code === 'airbnb') return <Home className={cls} aria-hidden />;
  if (code === 'booking') return <Building2 className={cls} aria-hidden />;
  return null;
}

function platformLabel(
  t: ReturnType<typeof useTranslations<'properties.form'>>,
  code: string,
): string {
  if (code === 'booking') return t('platformName_booking');
  if (code === 'airbnb') return t('platformName_airbnb');
  return code;
}

export function PropertyChannelIntegrationSection({
  register,
  control,
  errors,
  watch,
  setValue,
  icalLines,
  onIcalLinesChange,
}: PropertyChannelIntegrationSectionProps) {
  const t = useTranslations('properties.form');
  const { platforms, isLoading } = useOtaPlatforms();
  const previewMutation = useZodomusPropertyPreview();
  const listingsWatch = watch('channelListings');

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'channelListings',
  }) as UseFieldArrayReturn<FormInput, 'channelListings'>;

  const [loadResult, setLoadResult] = useState<{
    index: number;
    key: string;
    rooms: PreviewRoom[];
  } | null>(null);

  function addChannelRow() {
    const first = platforms[0];
    if (!first) {
      toast.error(t('channelPickerLoading'));
      return;
    }
    append({ otaPlatformId: first.id, externalListingId: '', zodomusRoomId: null });
  }

  function rowPickerKey(index: number): string {
    const row = listingsWatch?.[index];
    const plat = platforms.find((p) => p.id === row?.otaPlatformId);
    const channelId = plat?.zodomusChannelId;
    const ext = String(row?.externalListingId ?? '').trim();
    return channelId != null ? `${channelId}:${ext}` : '';
  }

  useEffect(() => {
    if (!loadResult) return;
    if (loadResult.index >= fields.length) {
      setLoadResult(null);
      return;
    }
    const row = listingsWatch?.[loadResult.index];
    const plat = platforms.find((p) => p.id === row?.otaPlatformId);
    const channelId = plat?.zodomusChannelId;
    const ext = String(row?.externalListingId ?? '').trim();
    const key = channelId != null ? `${channelId}:${ext}` : '';
    if (!key || loadResult.key !== key) {
      setLoadResult(null);
    }
  }, [fields.length, loadResult, listingsWatch, platforms]);

  async function loadFromZodomus(index: number) {
    const row = listingsWatch?.[index];
    const plat = platforms.find((p) => p.id === row?.otaPlatformId);
    const channelId = plat?.zodomusChannelId;
    const ext = String(row?.externalListingId ?? '').trim();
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
      setValue(`channelListings.${index}.externalListingId`, p.externalPropertyId.trim(), {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(`channelListings.${index}.zodomusRoomId`, p.externalPropertyId.trim() || null, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setLoadResult({
        index,
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

  const duplicateErr =
    errors.channelListings &&
    typeof errors.channelListings === 'object' &&
    'message' in errors.channelListings &&
    errors.channelListings.message === 'duplicate_ota_channel';

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
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">{t('integrationsSection')}</p>
            <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">
              {t('channelListingsIntro')}
            </p>
          </div>
        </header>

        {duplicateErr && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {t('duplicateOtaChannel')}
          </p>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t('channelListingsHeading')}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5"
              disabled={isLoading || platforms.length === 0}
              onClick={() => addChannelRow()}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('addChannelButton')}
            </Button>
          </div>

          {isLoading && (
            <div className="flex min-h-[3rem] items-center rounded-xl border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground">
              {t('channelPickerLoading')}
            </div>
          )}

          {!isLoading && fields.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/50 bg-muted/10 p-3 sm:p-4">
                <Label htmlFor="manual-zodomus-property-id" className="text-xs">
                  {t('manualZodomusStandaloneLabel')}
                </Label>
                <Input
                  id="manual-zodomus-property-id"
                  placeholder={t('manualZodomusStandalonePlaceholder')}
                  autoComplete="off"
                  className="mt-1.5 min-h-11 w-full font-mono text-sm tabular-nums"
                  aria-invalid={!!errors.zodomusPropertyId}
                  aria-describedby="manual-zodomus-hint"
                  {...register('zodomusPropertyId')}
                />
                <p id="manual-zodomus-hint" className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                  {t('manualZodomusStandaloneHint')}
                </p>
                {errors.zodomusPropertyId && (
                  <p className="mt-1 text-xs text-destructive">
                    {String(errors.zodomusPropertyId.message)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 py-4 text-center">
              <p className="text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">{t('channelsEmptyHint')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                disabled={platforms.length === 0}
                onClick={() => addChannelRow()}
              >
                <Plug2 className="h-3.5 w-3.5" aria-hidden />
                {t('addFirstChannel')}
              </Button>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {fields.map((field, index) => {
              const rowErrors = errors.channelListings?.[index];
              const platId = watch(`channelListings.${index}.otaPlatformId`);
              const selectedPlatform = platforms.find((p) => p.id === platId);
              const selectedCode = selectedPlatform?.code ?? '';
              const channelId = selectedPlatform?.zodomusChannelId;
              const hasOtaZodomus = Boolean(channelId);
              const zodomusRoomIdValue = watch(`channelListings.${index}.zodomusRoomId`);
              const zodomusHint =
                selectedCode === 'booking'
                  ? t('zodomusPropertyIdHintBooking')
                  : selectedCode === 'airbnb'
                    ? t('zodomusPropertyIdHintAirbnb')
                    : t('zodomusPropertyIdHint');

              const pickerKey = rowPickerKey(index);
              const lr = loadResult?.index === index && loadResult.key === pickerKey ? loadResult : null;

              return (
                <motion.div
                  key={field.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-xl border border-border/50 bg-muted/10 p-3 sm:p-4"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      {platformIcon(selectedCode)}
                      <span>{t('channelRowTitle', { n: index + 1 })}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        remove(index);
                        setLoadResult((prev) => (prev?.index === index ? null : prev));
                      }}
                      aria-label={t('removeChannel')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{t('channelRowPlatform')}</Label>
                      <Controller
                        name={`channelListings.${index}.otaPlatformId`}
                        control={control}
                        render={({ field: f }) => (
                          <Select
                            {...f}
                            className="min-h-11"
                            onChange={(e) => {
                              f.onChange(e);
                              setLoadResult((prev) => (prev?.index === index ? null : prev));
                            }}
                          >
                            {platforms.map((p) => (
                              <option key={p.id} value={p.id}>
                                {platformLabel(t, p.code)}
                              </option>
                            ))}
                          </Select>
                        )}
                      />
                    </div>

                    {hasOtaZodomus && (
                      <>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`ext-${field.id}`} className="text-xs">
                            {t('objectIdExternal')} *
                          </Label>
                          <Input
                            id={`ext-${field.id}`}
                            placeholder={t('objectIdExternalPlaceholder')}
                            autoComplete="off"
                            className="min-h-11 w-full font-mono text-sm tabular-nums"
                            aria-invalid={!!rowErrors?.externalListingId}
                            aria-describedby={`zodomus-hint-${field.id}`}
                            {...register(`channelListings.${index}.externalListingId`)}
                          />
                          <p id={`zodomus-hint-${field.id}`} className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                            {zodomusHint}
                          </p>
                          <p className="text-[11px] leading-snug text-muted-foreground/90 sm:text-[12px]">
                            {t('zodomusPreviewNoAddressHint')}
                          </p>
                          {rowErrors?.externalListingId && (
                            <p className="text-xs text-destructive">{String(rowErrors.externalListingId.message)}</p>
                          )}
                        </div>

                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`room-${field.id}`} className="text-xs">
                            {t('zodomusObjectIdLabel')} *
                          </Label>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                            <Input
                              id={`room-${field.id}`}
                              placeholder={t('zodomusObjectIdPlaceholder')}
                              autoComplete="off"
                              className="min-h-11 min-w-0 flex-1 font-mono text-sm tabular-nums"
                              aria-invalid={!!rowErrors?.zodomusRoomId}
                              aria-describedby={`zodomus-room-hint-${field.id} zodomus-load-hint-${field.id}`}
                              {...register(`channelListings.${index}.zodomusRoomId`)}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="default"
                              className="h-11 w-full shrink-0 gap-2 sm:h-auto sm:w-auto sm:min-w-[11rem]"
                              disabled={
                                !channelId ||
                                !String(watch(`channelListings.${index}.externalListingId`) ?? '').trim() ||
                                previewMutation.isPending
                              }
                              onClick={() => void loadFromZodomus(index)}
                            >
                              {previewMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              {t('previewLoadButton')}
                            </Button>
                          </div>
                          <p id={`zodomus-room-hint-${field.id}`} className="text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                            {t('zodomusObjectIdHint')}
                          </p>
                          <p
                            id={`zodomus-load-hint-${field.id}`}
                            className="text-[11px] leading-snug text-amber-600/90 dark:text-amber-400/90 sm:text-[12px]"
                          >
                            {t('zodomusPropertyIdHintLoad')}
                          </p>
                          {rowErrors?.zodomusRoomId && (
                            <p className="text-xs text-destructive">{String(rowErrors.zodomusRoomId.message)}</p>
                          )}
                        </div>

                        {lr && lr.rooms.length > 0 && (
                          <div
                            className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3 sm:col-span-2 sm:p-3.5"
                            role="group"
                            aria-label={t('previewRoomsTitle')}
                          >
                            <div className="flex items-start gap-2">
                              <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                              <div>
                                <p className="text-xs font-semibold text-foreground">{t('previewRoomsTitle')}</p>
                                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                                  {lr.rooms.length > 1 ? t('previewRoomsSubtitle') : t('previewRoomsSingle')}
                                </p>
                              </div>
                            </div>
                            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {lr.rooms.map((room) => {
                                const selected =
                                  String(zodomusRoomIdValue ?? '').trim() === String(room.id).trim();
                                const label = room.name?.trim() || room.id;
                                return (
                                  <li key={room.id}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setValue(`channelListings.${index}.zodomusRoomId`, room.id, {
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

                        {lr && <ZodomusRoomRatesPanel rooms={lr.rooms} className="sm:col-span-2" />}
                      </>
                    )}

                    {!hasOtaZodomus && (
                      <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 sm:col-span-2">
                        <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-[12px]">
                          {t('syncFlowNoOtaLead')}
                        </p>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="space-y-3 border-t border-border/50 pt-4">
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
        </div>
      </div>
    </div>
  );
}
