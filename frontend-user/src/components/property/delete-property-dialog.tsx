'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
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
      </DialogTrigger>
      <DialogContent title={t('deleteTitle')} description={t('deleteDescription', { name: propertyName })}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={isDeleting}>
              {t('form.cancel')}
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? t('deleting') : t('confirmDelete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
