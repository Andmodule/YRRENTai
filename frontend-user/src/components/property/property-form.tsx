'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { createPropertySchema } from '@rentai/shared';
import type { CreatePropertyDto, Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { TIMEZONES, CURRENCIES } from './property-field-options';

type FormInput = z.input<typeof createPropertySchema>;

interface PropertyFormProps {
  defaultValues?: Partial<Property>;
  onSubmit: (data: CreatePropertyDto) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
}

export function PropertyForm({ defaultValues, onSubmit, onCancel, submitLabel }: PropertyFormProps) {
  const t = useTranslations('properties.form');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, CreatePropertyDto>({
    resolver: zodResolver(createPropertySchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      country: defaultValues?.country ?? '',
      city: defaultValues?.city ?? '',
      address: defaultValues?.address ?? '',
      description: defaultValues?.description ?? '',
      timezone: defaultValues?.timezone ?? 'UTC',
      currency: defaultValues?.currency ?? 'USD',
      maxGuests: defaultValues?.maxGuests,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
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

      <div className="space-y-1.5">
        <Label htmlFor="description" className="text-xs">
          {t('description')}
        </Label>
        <Textarea
          id="description"
          placeholder={t('descriptionPlaceholder')}
          rows={3}
          {...register('description')}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="timezone" className="text-xs">
            {t('timezone')} *
          </Label>
          <Select id="timezone" {...register('timezone')}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency" className="text-xs">
            {t('currency')} *
          </Label>
          <Select id="currency" {...register('currency')}>
            {CURRENCIES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="max-w-[8rem] space-y-1.5">
        <Label htmlFor="maxGuests" className="text-xs">
          {t('maxGuests')}
        </Label>
        <Input
          id="maxGuests"
          type="number"
          min={1}
          max={100}
          placeholder={t('maxGuestsPlaceholder')}
          className="tabular-nums"
          {...register('maxGuests', {
            setValueAs: (v: string) => (v === '' || v === undefined ? undefined : Number(v)),
          })}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('saving') : submitLabel}
        </Button>
      </div>
    </form>
  );
}
