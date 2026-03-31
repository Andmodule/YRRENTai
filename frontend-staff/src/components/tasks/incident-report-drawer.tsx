'use client';

import { useState } from 'react';
import axios from 'axios';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useUploadIncidentPhotos, useCreateIncident } from '@/hooks/use-tasks';
import { strings } from '@/strings/tasks';
import { toast } from 'sonner';

interface IncidentReportDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  taskId: string | null;
  initialType?: 'lost_item' | 'damage';
}

export function IncidentReportDrawer({
  open,
  onOpenChange,
  propertyId,
  taskId,
  initialType = 'lost_item',
}: IncidentReportDrawerProps) {
  const [type, setType] = useState<'lost_item' | 'damage'>(initialType);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [guestName, setGuestName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [damageLocation, setDamageLocation] = useState('');

  const { mutateAsync: uploadPhotos, isPending: uploadPending } = useUploadIncidentPhotos();
  const { mutateAsync: createIncident, isPending: createPending } = useCreateIncident();

  const reset = () => {
    setFiles([]);
    setDescription('');
    setGuestName('');
    setItemDescription('');
    setDamageLocation('');
    setType(initialType);
  };

  const submit = async () => {
    if (type === 'damage' && !description.trim()) {
      toast.error('Опишите повреждение');
      return;
    }
    if (type === 'lost_item' && !itemDescription.trim() && !description.trim()) {
      toast.error('Опишите находку');
      return;
    }
    try {
      const photoUrls = files.length > 0 ? await uploadPhotos(files) : [];
      await createIncident({
        type,
        propertyId,
        taskId,
        description: type === 'damage' ? description.trim() : description.trim() || itemDescription.trim(),
        photoUrls,
        guestName: guestName.trim() || null,
        itemDescription: type === 'lost_item' ? itemDescription.trim() || null : null,
        damageLocation: type === 'damage' ? damageLocation.trim() || null : null,
      });
      toast.success(strings.tasks.incident.success);
      reset();
      onOpenChange(false);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.data) {
        const d = e.response.data as { message?: string | string[] };
        const msg = Array.isArray(d.message) ? d.message.join(', ') : d.message;
        if (msg) {
          toast.error(msg);
          return;
        }
      }
      toast.error('Не удалось отправить');
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Инцидент">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={type === 'lost_item' ? 'default' : 'outline'}
              className="flex-1 gap-1"
              onClick={() => setType('lost_item')}
            >
              <KeyRound className="h-4 w-4" />
              {strings.tasks.incident.lostItem}
            </Button>
            <Button
              type="button"
              variant={type === 'damage' ? 'default' : 'outline'}
              className="flex-1 gap-1"
              onClick={() => setType('damage')}
            >
              <AlertTriangle className="h-4 w-4" />
              {strings.tasks.incident.damage}
            </Button>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Фото (необязательно, до 5)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              className="mt-1 block w-full text-sm"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
            />
          </div>

          {type === 'lost_item' && (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600">Что нашли</label>
                <Textarea
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  rows={3}
                  placeholder="Опишите вещь"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Имя гостя (если знаете)</label>
                <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              </div>
            </>
          )}

          {type === 'damage' && (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600">Что повреждено</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Где</label>
                <Input value={damageLocation} onChange={(e) => setDamageLocation(e.target.value)} />
              </div>
            </>
          )}

          <Button
            className="w-full"
            disabled={uploadPending || createPending}
            onClick={() => void submit()}
          >
            {strings.tasks.incident.submit}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
