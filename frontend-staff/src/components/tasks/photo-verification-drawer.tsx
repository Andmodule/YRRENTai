'use client';

import { useRef, useState } from 'react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useUploadTaskPhotos } from '@/hooks/use-tasks';
import { compressImageFile } from '@/lib/compress-image';

interface PhotoVerificationDrawerProps {
  taskUuid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PhotoVerificationDrawer({ taskUuid, open, onOpenChange }: PhotoVerificationDrawerProps) {
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
      onOpenChange(false);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Прикрепите фото готовой комнаты">
        <p className="mb-4 text-sm text-slate-600">
          Опционально: фото помогает менеджеру убедиться в качестве уборки.
        </p>
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
          Пропустить
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
