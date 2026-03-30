'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KbEntryForm } from './kb-entry-form';
import type { KbEntry } from '@/types';

interface CreateEntryDialogProps {
  onCreate: (data: { title: string; content: string; category: string }) => Promise<unknown>;
}

export function CreateKbEntryDialog({ onCreate }: CreateEntryDialogProps) {
  const t = useTranslations('kb');
  const [open, setOpen] = useState(false);

  async function handleSubmit(data: { title: string; content: string; category: string }) {
    try {
      await onCreate(data);
      toast.success(t('createSuccess'));
      setOpen(false);
    } catch {
      toast.error(t('createError'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('addEntry')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('createTitle')}>
        <KbEntryForm
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel={t('createSubmit')}
        />
      </DialogContent>
    </Dialog>
  );
}

interface EditEntryDialogProps {
  entry: KbEntry;
  onUpdate: (data: { title?: string; content?: string; category?: string }) => Promise<unknown>;
}

export function EditKbEntryDialog({ entry, onUpdate }: EditEntryDialogProps) {
  const t = useTranslations('kb');
  const [open, setOpen] = useState(false);

  async function handleSubmit(data: { title: string; content: string; category: string }) {
    try {
      await onUpdate(data);
      toast.success(t('updateSuccess'));
      setOpen(false);
    } catch {
      toast.error(t('updateError'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent title={t('editTitle')} description={entry.title}>
        <KbEntryForm
          defaultValues={entry}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel={t('updateSubmit')}
        />
      </DialogContent>
    </Dialog>
  );
}

interface DeleteEntryDialogProps {
  entryTitle: string;
  onDelete: () => Promise<void>;
}

export function DeleteKbEntryDialog({ entryTitle, onDelete }: DeleteEntryDialogProps) {
  const t = useTranslations('kb');
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
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent title={t('deleteTitle')} description={t('deleteDescription', { title: entryTitle })}>
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
