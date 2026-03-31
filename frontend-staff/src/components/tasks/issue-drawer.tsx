'use client';

import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateTaskStatus, useUploadTaskPhotos } from '@/hooks/use-tasks';
import { compressImageFile } from '@/lib/compress-image';

interface IssueDrawerProps {
  taskUuid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueDrawer({ taskUuid, open, onOpenChange }: IssueDrawerProps) {
  const [description, setDescription] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate: updateStatus, isPending: isUpdating } = useUpdateTaskStatus();
  const { mutate: uploadPhotos, isPending: isUploading } = useUploadTaskPhotos();

  const isPending = isUpdating || isUploading;

  const handleClose = () => {
    setDescription('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!taskUuid) return;
    if (!description.trim()) {
      toast.error('Опишите проблему');
      return;
    }

    try {
      await new Promise<void>((resolve, reject) =>
        updateStatus(
          { uuid: taskUuid, status: 'issue', issueDescription: description.trim() },
          { onSuccess: () => resolve(), onError: reject },
        ),
      );

      const files = fileRef.current?.files;
      if (files?.length) {
        const compressed: File[] = [];
        for (const f of Array.from(files)) {
          const blob = await compressImageFile(f);
          compressed.push(new File([blob], f.name, { type: 'image/jpeg' }));
        }
        await new Promise<void>((resolve, reject) =>
          uploadPhotos(
            { uuid: taskUuid, files: compressed },
            { onSuccess: () => resolve(), onError: reject },
          ),
        );
      }

      toast.success('Проблема зафиксирована');
      handleClose();
    } catch {
      toast.error('Ошибка. Попробуйте ещё раз');
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Сообщить о проблеме">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Описание проблемы <span className="text-slate-400">*</span>
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Опишите что произошло…"
              rows={4}
              required
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Фото (необязательно)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500 hover:bg-gray-100 transition-colors">
              <span>📷 Сфотографировать / выбрать из галереи</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <DrawerClose asChild>
            <Button variant="outline" className="flex-1" onClick={handleClose}>
              Отмена
            </Button>
          </DrawerClose>
          <Button
            className="flex-1 bg-amber-600 text-white hover:bg-amber-700"
            disabled={isPending || !description.trim()}
            onClick={() => void handleSubmit()}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Сообщить
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
