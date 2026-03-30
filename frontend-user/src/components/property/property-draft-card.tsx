'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, X, Loader2, Building2 } from 'lucide-react';
import type { z } from 'zod';
import { createPropertySchema } from '@rentai/shared';
import type { CreatePropertyDto } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TIMEZONES, CURRENCIES } from './property-field-options';

type FormInput = z.input<typeof createPropertySchema>;

interface PropertyDraftCardProps {
  onCreate: (dto: CreatePropertyDto) => Promise<unknown>;
  onDiscard: () => void;
}

export function PropertyDraftCard({ onCreate, onDiscard }: PropertyDraftCardProps) {
  const t = useTranslations('properties');
  const tf = useTranslations('properties.form');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, CreatePropertyDto>({
    resolver: zodResolver(createPropertySchema),
    defaultValues: {
      name: '',
      address: '',
      timezone: 'UTC',
      currency: 'USD',
      maxGuests: undefined,
    },
  });

  async function onSubmit(data: CreatePropertyDto) {
    try {
      await onCreate(data);
      toast.success(t('createSuccess'));
    } catch {
      toast.error(t('createError'));
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.02] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Building2 className="h-4 w-4 text-primary" />
        {t('createTitle')}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="draft-name" className="text-xs">
            {tf('name')} *
          </Label>
          <Input
            id="draft-name"
            autoFocus
            placeholder={tf('namePlaceholder')}
            aria-invalid={!!errors.name}
            {...register('name')}
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="draft-address" className="text-xs">
            {tf('address')} *
          </Label>
          <Input
            id="draft-address"
            placeholder={tf('addressPlaceholder')}
            aria-invalid={!!errors.address}
            {...register('address')}
          />
          {errors.address && (
            <p className="text-xs text-destructive">{errors.address.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="draft-tz" className="text-xs">
              {tf('timezone')} *
            </Label>
            <Select id="draft-tz" {...register('timezone')}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="draft-currency" className="text-xs">
              {tf('currency')} *
            </Label>
            <Select id="draft-currency" {...register('currency')}>
              {CURRENCIES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="draft-guests" className="text-xs">
            {tf('maxGuests')}
          </Label>
          <Input
            id="draft-guests"
            type="number"
            min={1}
            max={100}
            placeholder={tf('maxGuestsPlaceholder')}
            {...register('maxGuests', {
              setValueAs: (v: string) => (v === '' || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-primary/20 pt-3">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isSubmitting}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            aria-label={tf('cancel')}
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            aria-label={t('createSubmit')}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
