'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { ChevronDown, Check, Loader2, X } from 'lucide-react';
import { z } from 'zod';
import { createPropertySchema } from '@rentai/shared';
import type { CreatePropertyDto, Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseIcalImportLines } from '@/lib/ical-import-lines';
import { Select } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { TIMEZONES, CURRENCIES, DEFAULT_PROPERTY_TIMEZONE } from './property-field-options';
import { PropertyChannelIntegrationSection } from './property-channel-integration-section';

type FormInput = z.input<typeof createPropertySchema>;

interface PropertyFormProps {
  defaultValues?: Partial<Property>;
  onSubmit: (data: CreatePropertyDto) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
  /**
   * When omitted: new objects (`defaultValues` without `id`) use a collapsed “Advanced” block
   * for integrations + WhatsApp; editing an existing property keeps the full layout.
   */
  collapseAdvancedSection?: boolean;
  /** Compact icon actions (draft card on property list). */
  footerStyle?: 'default' | 'draft-icons';
  /**
   * Только у сохранённого объекта: сброс OTA через API (рядом с полем/каналами),
   * без ожидания «Сохранить».
   */
  onClearOta?: () => Promise<void>;
}

export function PropertyForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel,
  collapseAdvancedSection,
  footerStyle = 'default',
  onClearOta,
}: PropertyFormProps) {
  const t = useTranslations('properties.form');
  const useCompactAdvanced =
    collapseAdvancedSection !== undefined
      ? collapseAdvancedSection
      : defaultValues?.id == null || String(defaultValues?.id ?? '').trim() === '';

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, CreatePropertyDto>({
    resolver: zodResolver(createPropertySchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      country: defaultValues?.country ?? '',
      city: defaultValues?.city ?? '',
      address: defaultValues?.address ?? '',
      timezone: defaultValues?.timezone ?? DEFAULT_PROPERTY_TIMEZONE,
      currency: defaultValues?.currency ?? 'USD',
      channelListings: (() => {
        const list = defaultValues?.channelListings;
        if (list?.length) {
          return list.map((l) => ({
            otaPlatformId: l.otaPlatformId,
            externalListingId: l.externalListingId,
            zodomusRoomId: l.zodomusRoomId ?? null,
          }));
        }
        const legacyOta = defaultValues?.otaPlatformId ?? defaultValues?.otaPlatform?.id;
        const legacyZ = defaultValues?.zodomusPropertyId?.trim();
        if (legacyOta && legacyZ) {
          return [
            {
              otaPlatformId: legacyOta,
              externalListingId: legacyZ,
              zodomusRoomId: defaultValues?.zodomusRoomId?.trim() || null,
            },
          ];
        }
        return [];
      })(),
      zodomusPropertyId: (() => {
        const list = defaultValues?.channelListings;
        if (list?.length) return '';
        const legacyOta = defaultValues?.otaPlatformId ?? defaultValues?.otaPlatform?.id;
        const legacyZ = defaultValues?.zodomusPropertyId?.trim();
        if (legacyOta && legacyZ) return '';
        return defaultValues?.zodomusPropertyId?.trim() ?? '';
      })(),
      icalImportUrls: defaultValues?.icalImportUrls ?? [],
      whatsappPhoneNumberId: defaultValues?.whatsappPhoneNumberId ?? '',
      whatsappAccessToken: '',
    },
  });

  const [icalLines, setIcalLines] = useState(() =>
    (defaultValues?.icalImportUrls ?? []).join('\n'),
  );

  useEffect(() => {
    setIcalLines((defaultValues?.icalImportUrls ?? []).join('\n'));
  }, [defaultValues?.id, defaultValues?.updatedAt]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);

  useEffect(() => {
    if (
      defaultValues?.whatsappPhoneNumberId?.trim() ||
      defaultValues?.whatsappAccessTokenSet
    ) {
      setWhatsappOpen(true);
    }
  }, [defaultValues?.id, defaultValues?.whatsappPhoneNumberId, defaultValues?.whatsappAccessTokenSet]);

  useEffect(() => {
    if (!useCompactAdvanced) return;
    const hasAdvancedErrors =
      !!errors.channelListings ||
      !!errors.zodomusPropertyId ||
      !!errors.whatsappPhoneNumberId ||
      !!errors.whatsappAccessToken;
    if (hasAdvancedErrors) setAdvancedOpen(true);
  }, [
    useCompactAdvanced,
    errors.channelListings,
    errors.zodomusPropertyId,
    errors.whatsappPhoneNumberId,
    errors.whatsappAccessToken,
  ]);

  useEffect(() => {
    if (!!errors.whatsappPhoneNumberId || !!errors.whatsappAccessToken) {
      setWhatsappOpen(true);
    }
  }, [errors.whatsappPhoneNumberId, errors.whatsappAccessToken]);

  const integrationsAndWhatsApp = (
    <>
      <PropertyChannelIntegrationSection
        register={register}
        control={control}
        errors={errors}
        watch={watch}
        setValue={setValue}
        icalLines={icalLines}
        onIcalLinesChange={setIcalLines}
        otaServerSnapshot={defaultValues}
        onClearOta={onClearOta}
      />

      <Collapsible open={whatsappOpen} onOpenChange={setWhatsappOpen} className="border-t border-border/60 pt-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-md py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70 transition-transform',
                whatsappOpen && 'rotate-180',
              )}
              aria-hidden
            />
            <span className="min-w-0 leading-snug">
              <span className="text-foreground/90">{t('whatsappSection')}</span>
              <span className="text-muted-foreground"> — {t('whatsappCollapsibleHint')}</span>
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:hidden">
          <p className="text-xs text-muted-foreground">{t('whatsappSectionHint')}</p>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t('whatsappRulesTitle')}</p>
            <p className="mt-1 leading-relaxed">{t('whatsappRulesBody')}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="whatsappPhoneNumberId" className="text-xs">
                {t('whatsappPhoneNumberId')}
              </Label>
              <Input
                id="whatsappPhoneNumberId"
                placeholder={t('whatsappPhoneNumberIdPlaceholder')}
                autoComplete="off"
                {...register('whatsappPhoneNumberId')}
              />
              <p className="text-xs text-muted-foreground">{t('whatsappPhoneNumberIdHint')}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="whatsappAccessToken" className="text-xs">
                {t('whatsappAccessToken')}
              </Label>
              <Input
                id="whatsappAccessToken"
                type="password"
                placeholder={
                  defaultValues?.whatsappAccessTokenSet
                    ? t('whatsappAccessTokenPlaceholderKeep')
                    : t('whatsappAccessTokenPlaceholder')
                }
                autoComplete="new-password"
                {...register('whatsappAccessToken')}
              />
              <p className="text-xs text-muted-foreground">
                {defaultValues?.whatsappAccessTokenSet
                  ? t('whatsappAccessTokenHintKeep')
                  : t('whatsappAccessTokenHint')}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );

  return (
    <form
      onSubmit={handleSubmit((data) => {
        const payload = { ...data, icalImportUrls: parseIcalImportLines(icalLines) };
        if (defaultValues?.whatsappAccessTokenSet && !payload.whatsappAccessToken?.trim()) {
          delete payload.whatsappAccessToken;
        }
        if (payload.channelListings?.length) {
          const { zodomusPropertyId: _z, ...rest } = payload;
          void onSubmit(rest);
        } else {
          void onSubmit({
            ...payload,
            zodomusPropertyId: payload.zodomusPropertyId?.trim() || null,
          });
        }
      })}
      className="space-y-3"
    >
      <div className="space-y-3">
        <p className="text-xs font-semibold tracking-tight text-foreground">{t('basicDetailsSection')}</p>

        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs">
            {t('name')} *
          </Label>
          <Input
            id="name"
            placeholder={t('namePlaceholder')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'name-error' : undefined}
            {...register('name')}
          />
          {errors.name && (
            <p id="name-error" className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="country" className="text-xs">
              {t('country')} *
            </Label>
            <Input
              id="country"
              placeholder={t('countryPlaceholder')}
              aria-invalid={!!errors.country}
              {...register('country')}
            />
            {errors.country && (
              <p className="text-xs text-destructive">{errors.country.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city" className="text-xs">
              {t('city')} *
            </Label>
            <Input
              id="city"
              placeholder={t('cityPlaceholder')}
              aria-invalid={!!errors.city}
              {...register('city')}
            />
            {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address" className="text-xs">
            {t('addressFull')} *
          </Label>
          <Input
            id="address"
            placeholder={t('addressPlaceholder')}
            aria-invalid={!!errors.address}
            aria-describedby={errors.address ? 'address-error' : undefined}
            {...register('address')}
          />
          {errors.address && (
            <p id="address-error" className="text-xs text-destructive">{errors.address.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="timezone" className="text-xs">
              {t('timezone')} *
            </Label>
            <Select id="timezone" {...register('timezone')}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="currency" className="text-xs">
              {t('currency')} *
            </Label>
            <Select id="currency" {...register('currency')}>
              {CURRENCIES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {useCompactAdvanced ? (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="space-y-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="flex h-auto min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-normal"
            >
              <span className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium text-foreground">{t('advancedSettingsSection')}</span>
                <span className="text-[11px] font-normal text-muted-foreground">{t('advancedSettingsHint')}</span>
              </span>
              <ChevronDown
                className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 data-[state=closed]:hidden">
            {integrationsAndWhatsApp}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        integrationsAndWhatsApp
      )}

      <div
        className={cn(
          'flex justify-end gap-2 pt-2',
          footerStyle === 'draft-icons' && 'border-t border-primary/20 pt-3',
        )}
      >
        {footerStyle === 'draft-icons' ? (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              aria-label={t('cancel')}
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              aria-label={submitLabel}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : submitLabel}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
