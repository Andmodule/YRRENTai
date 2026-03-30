'use client';

import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { KB_CATEGORIES, CATEGORY_ICONS } from './kb-category-badge';
import type { KbEntry } from '@/types';

interface KbEntryFormValues {
  title: string;
  content: string;
  category: string;
}

interface KbEntryFormProps {
  defaultValues?: Partial<KbEntry>;
  onSubmit: (data: KbEntryFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

export function KbEntryForm({ defaultValues, onSubmit, onCancel, submitLabel }: KbEntryFormProps) {
  const t = useTranslations('kb.form');
  const tCat = useTranslations('kb.categories');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KbEntryFormValues>({
    defaultValues: {
      title: defaultValues?.title ?? '',
      content: defaultValues?.content ?? '',
      category: defaultValues?.category ?? 'other',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="kb-category">{t('category')}</Label>
        <Select id="kb-category" {...register('category')}>
          {KB_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_ICONS[cat]} {tCat(cat)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="kb-title">{t('title')} *</Label>
        <Input
          id="kb-title"
          placeholder={t('titlePlaceholder')}
          aria-invalid={!!errors.title}
          {...register('title', { required: true })}
        />
        {errors.title && (
          <p className="text-xs text-destructive">{t('titleRequired')}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="kb-content">{t('content')} *</Label>
        <Textarea
          id="kb-content"
          placeholder={t('contentPlaceholder')}
          rows={5}
          aria-invalid={!!errors.content}
          {...register('content', { required: true })}
        />
        {errors.content && (
          <p className="text-xs text-destructive">{t('contentRequired')}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
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
