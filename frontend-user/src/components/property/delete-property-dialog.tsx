'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';

function apiErrorMessage(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>;
      const m = d.message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ');
    }
  }
  if (e instanceof Error) return e.message;
  return undefined;
}

interface DeletePropertyDialogProps {
  propertyName: string;
  onDelete: () => Promise<void>;
  /** Opens the confirmation dialog; defaults to ghost button with trash + label */
  trigger?: ReactElement;
}

export function DeletePropertyDialog({ propertyName, onDelete, trigger }: DeletePropertyDialogProps) {
  const t = useTranslations('properties');
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete();
      toast.success(t('deleteSuccess'));
      setOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e) ?? t('deleteError'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={setOpen}>
      <ResponsiveModalTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {t('delete')}
          </Button>
        )}
      </ResponsiveModalTrigger>
      <ResponsiveModalContent title={t('deleteTitle')} description={t('deleteDescription', { name: propertyName })}>
        <div className="flex justify-end gap-2">
          <ResponsiveModalClose asChild>
            <Button variant="outline" disabled={isDeleting}>
              {t('form.cancel')}
            </Button>
          </ResponsiveModalClose>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? t('deleting') : t('confirmDelete')}
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
