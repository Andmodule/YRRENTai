'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import type { CreatePropertyDto } from '@/types';
import { PropertyForm } from './property-form';

interface PropertyDraftCardProps {
  onCreate: (dto: CreatePropertyDto) => Promise<unknown>;
  onDiscard: () => void;
}

export function PropertyDraftCard({ onCreate, onDiscard }: PropertyDraftCardProps) {
  const t = useTranslations('properties');

  return (
    <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.02] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Building2 className="h-4 w-4 text-primary" />
        {t('createTitle')}
      </div>

      <PropertyForm
        defaultValues={undefined}
        onSubmit={async (dto) => {
          try {
            await onCreate(dto);
            toast.success(t('createSuccess'));
          } catch {
            toast.error(t('createError'));
          }
        }}
        onCancel={onDiscard}
        submitLabel={t('createSubmit')}
        footerStyle="draft-icons"
      />
    </div>
  );
}
