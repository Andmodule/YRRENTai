'use client';

import { useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { History, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import type { Task } from '@/hooks/use-tasks';
import {
  useAppendStaffIncidentPhotos,
  useStaffIncidentHistory,
  type StaffIncidentHistoryItem,
} from '@/hooks/use-tasks';
import { useStaffStrings } from '@/locales/staff-strings';
import { compressImageFile } from '@/lib/compress-image';
import { cn } from '@/lib/utils';
import type { StaffSupplementContext } from './staff-history-supplement-sheet';

function taskTypeLabel(type: string): string {
  const m: Record<string, string> = {
    checkout_cleaning: 'Уборка (выезд)',
    checkin_prep: 'Подготовка к заезду',
    mid_stay_cleaning: 'Плановая уборка',
    manual: 'Задача',
  };
  return m[type] ?? type;
}

export function StaffHistoryDrawer({
  open,
  onOpenChange,
  tasks,
  onRequestTaskPhoto,
  onRequestIncidentPhoto,
  onRequestSupplement,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  onRequestTaskPhoto: (taskUuid: string) => void;
  onRequestIncidentPhoto: (incidentUuid: string) => void;
  /** Клик по карточке — доп. текст (закрывает историю и открывает sheet дополнения). */
  onRequestSupplement: (ctx: StaffSupplementContext) => void;
}) {
  const h = useStaffStrings().tasks.history;
  const [tab, setTab] = useState<'tasks' | 'incidents'>('tasks');
  const { data: incidents, isLoading: incidentsLoading } = useStaffIncidentHistory(open);

  const doneTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'done')
      .sort((a, b) => {
        const ac = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bc = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bc - ac;
      });
  }, [tasks]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={h.drawerTitle}>
        <p className="mb-3 text-sm text-slate-600">{h.hint}</p>

        <div className="mb-3 flex gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
              tab === 'tasks' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600',
            )}
            onClick={() => setTab('tasks')}
          >
            {h.tabTasks}
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
              tab === 'incidents' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600',
            )}
            onClick={() => setTab('incidents')}
          >
            {h.tabIncidents}
          </button>
        </div>

        <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
          {tab === 'tasks' &&
            (doneTasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">{h.emptyTasks}</p>
            ) : (
              doneTasks.map((t) => (
                <div
                  key={t.uuid}
                  tabIndex={0}
                  className="cursor-pointer rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-sm outline-none ring-teal-500/30 focus-visible:ring-2"
                  onClick={() =>
                    onRequestSupplement({
                      kind: 'task',
                      id: t.uuid,
                      label: [taskTypeLabel(t.type), t.propertyTitle, t.contextLabel].filter(Boolean).join(' · '),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRequestSupplement({
                        kind: 'task',
                        id: t.uuid,
                        label: [taskTypeLabel(t.type), t.propertyTitle, t.contextLabel].filter(Boolean).join(' · '),
                      });
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {[taskTypeLabel(t.type), t.propertyTitle, t.contextLabel].filter(Boolean).join(' · ')}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t.completedAt
                          ? format(parseISO(t.completedAt), 'd MMM yyyy, HH:mm', { locale: ru })
                          : t.dueDate}
                        {t.hasVerificationPhoto ? (
                          <span className="ml-2 text-emerald-700">· {h.taskHasPhotoBadge}</span>
                        ) : (
                          <span className="ml-2 text-amber-700">· {h.taskNoPhotoBadge}</span>
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1 rounded-lg"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestTaskPhoto(t.uuid);
                      }}
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                      {h.addPhoto}
                    </Button>
                  </div>
                </div>
              ))
            ))}

          {tab === 'incidents' &&
            (incidentsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-teal-600" aria-hidden />
              </div>
            ) : !incidents?.length ? (
              <p className="py-6 text-center text-sm text-slate-500">{h.emptyIncidents}</p>
            ) : (
              incidents.map((inc) => (
                <IncidentHistoryRow
                  key={inc.uuid}
                  item={inc}
                  onRequestIncidentPhoto={() => onRequestIncidentPhoto(inc.uuid)}
                  onRequestSupplement={() =>
                    onRequestSupplement({
                      kind: 'incident',
                      id: inc.uuid,
                      label: [h.typeLabels[inc.type] ?? inc.type, inc.propertyTitle].filter(Boolean).join(' · '),
                    })
                  }
                />
              ))
            ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function IncidentHistoryRow({
  item,
  onRequestIncidentPhoto,
  onRequestSupplement,
}: {
  item: StaffIncidentHistoryItem;
  onRequestIncidentPhoto: () => void;
  onRequestSupplement: () => void;
}) {
  const h = useStaffStrings().tasks.history;
  const typeLabel = h.typeLabels[item.type] ?? item.type;

  return (
    <div
      tabIndex={0}
      className="cursor-pointer rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left text-sm outline-none ring-teal-500/30 focus-visible:ring-2"
      onClick={onRequestSupplement}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRequestSupplement();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{typeLabel}</p>
          <p className="font-medium text-slate-900">{item.propertyTitle}</p>
          <p className="mt-1 line-clamp-2 text-slate-600">{item.descriptionPreview}</p>
          <p className="mt-1 text-xs text-slate-500">
            {format(parseISO(item.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })} ·{' '}
            {h.photosCount(item.photoUrls.length)}
          </p>
          {item.photoUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.photoUrls.slice(0, 4).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200/80"
                />
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1 rounded-lg"
          onClick={(e) => {
            e.stopPropagation();
            onRequestIncidentPhoto();
          }}
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          {h.addPhoto}
        </Button>
      </div>
    </div>
  );
}

export function StaffIncidentPhotoAppendDrawer({
  incidentUuid,
  open,
  onOpenChange,
}: {
  incidentUuid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const h = useStaffStrings().tasks.history;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { mutateAsync: append } = useAppendStaffIncidentPhotos();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const compressed: File[] = [];
      for (const f of Array.from(files)) {
        const blob = await compressImageFile(f);
        compressed.push(new File([blob], f.name, { type: 'image/jpeg' }));
      }
      await append({ uuid: incidentUuid, files: compressed });
      toast.success(h.incidentUploadSuccess);
      onOpenChange(false);
    } catch {
      toast.error(h.incidentUploadFail);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={h.incidentPhotoTitle}>
        <p className="mb-4 text-sm text-slate-600">{h.incidentPhotoHint}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(e) => void handleFile(e)}
        />
        <Button
          className="mb-3 w-full"
          size="lg"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? h.photosUploading : h.incidentPhotoPrimary}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-slate-500"
          disabled={uploading}
          onClick={() => onOpenChange(false)}
        >
          {h.incidentPhotoCancel}
        </Button>
      </DrawerContent>
    </Drawer>
  );
}

export function StaffHistoryFab({ onClick }: { onClick: () => void }) {
  const h = useStaffStrings().tasks.history;
  return (
    <button
      type="button"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-transform active:scale-95"
      aria-label={h.fabAria}
      onClick={onClick}
    >
      <History className="h-5 w-5" aria-hidden />
    </button>
  );
}
