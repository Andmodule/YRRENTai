'use client';

import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateIncident, useUploadIncidentPhotos } from '@/hooks/use-tasks';
import { compressImageFile } from '@/lib/compress-image';
import { useStaffStrings } from '@/locales/staff-strings';
import type { Task } from '@/hooks/use-tasks';

interface IssueDrawerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueDrawer({ task, open, onOpenChange }: IssueDrawerProps) {
  const ti = useStaffStrings().tasks.taskIssue;
  const [description, setDescription] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: createIncident, isPending: createPending } = useCreateIncident();
  const { mutateAsync: uploadIncidentPhotos, isPending: uploadPending } = useUploadIncidentPhotos();

  const isPending = createPending || uploadPending;

  const handleClose = () => {
    setDescription('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!task) return;
    if (!description.trim()) {
      toast.error(ti.describeRequired);
      return;
    }

    try {
      const files = fileRef.current?.files;
      let photoUrls: string[] = [];
      if (files?.length) {
        const compressed: File[] = [];
        for (const f of Array.from(files)) {
          const blob = await compressImageFile(f);
          compressed.push(new File([blob], f.name, { type: 'image/jpeg' }));
        }
        photoUrls = await uploadIncidentPhotos(compressed);
      }

      await createIncident({
        type: 'task_report',
        propertyId: task.propertyId,
        taskId: task.uuid,
        description: description.trim(),
        photoUrls,
      });

      toast.success(ti.success);
      handleClose();
    } catch {
      toast.error(ti.errorGeneric);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={ti.drawerTitle}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              {ti.descriptionLabel} <span className="text-slate-400">*</span>
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={ti.descriptionPlaceholder}
              rows={4}
              required
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">{ti.photosOptional}</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500 transition-colors hover:bg-gray-100">
              <span>{ti.photoPicker}</span>
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
              {ti.cancel}
            </Button>
          </DrawerClose>
          <Button
            className="flex-1 bg-amber-600 text-white hover:bg-amber-700"
            disabled={isPending || !description.trim()}
            onClick={() => void handleSubmit()}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {ti.submit}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
