'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useUploadTaskPhotos } from '@/hooks/use-tasks';
import { compressImageFile } from '@/lib/compress-image';

interface PhotoVerificationDrawerProps {
  taskUuid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Из истории: другой заголовок (дополнить фото к уже завершённой задаче). */
  variant?: 'default' | 'supplement';
  title?: string;
  description?: string;
}

export function PhotoVerificationDrawer({
  taskUuid,
  open,
  onOpenChange,
  variant = 'default',
  title,
  description,
}: PhotoVerificationDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { mutateAsync: upload } = useUploadTaskPhotos();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !taskUuid) return;
    setUploading(true);
    try {
      const compressed: File[] = [];
      for (const f of Array.from(files)) {
        const blob = await compressImageFile(f);
        compressed.push(new File([blob], f.name, { type: 'image/jpeg' }));
      }
      await upload({ uuid: taskUuid, files: compressed });
      toast.success(variant === 'supplement' ? 'Фото добавлены к задаче' : 'Фото прикреплены');
      onOpenChange(false);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const resolvedTitle =
    title ??
    (variant === 'supplement'
      ? 'Добавить фото к задаче'
      : 'Прикрепите фото готовой комнаты');
  const resolvedDescription =
    description ??
    (variant === 'supplement'
      ? 'Фото будут добавлены к уже завершённой задаче (верификация для менеджера).'
      : 'Опционально: фото помогает менеджеру убедиться в качестве уборки.');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={resolvedTitle}>
        <p className="mb-4 text-sm text-slate-600">{resolvedDescription}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => void handleFile(e)}
        />
        <Button
          className="mb-3 w-full"
          size="lg"
          disabled={uploading || !taskUuid}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Загрузка…' : 'Сделать фото'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-slate-500"
          disabled={uploading}
          onClick={() => onOpenChange(false)}
        >
          {variant === 'supplement' ? 'Отмена' : 'Пропустить'}
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
