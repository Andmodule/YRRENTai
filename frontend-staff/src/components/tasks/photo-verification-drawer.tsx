'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Send, Video, Clapperboard } from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useUploadTaskPhotos } from '@/hooks/use-tasks';
import { prepareStaffVerificationFiles, MAX_STAFF_VERIFICATION_FILES } from '@/lib/staff-prepare-media-files';
import { useStaffStrings } from '@/locales/staff-strings';
import { cn } from '@/lib/utils';

interface PhotoVerificationDrawerProps {
  taskUuid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: 'default' | 'supplement';
}

function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
}

export function PhotoVerificationDrawer({
  taskUuid,
  open,
  onOpenChange,
  variant = 'default',
}: PhotoVerificationDrawerProps) {
  const v = useStaffStrings().tasks.verification;
  const inputRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const prevQueueLength = useRef(0);
  const [queue, setQueue] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const { mutateAsync: upload, isPending: uploadMutationPending } = useUploadTaskPhotos();

  const title = useMemo(
    () => (variant === 'supplement' ? v.titleSupplement : v.titleDefault),
    [variant, v.titleDefault, v.titleSupplement],
  );
  const description = useMemo(
    () => (variant === 'supplement' ? v.descSupplement : v.descDefault),
    [variant, v.descDefault, v.descSupplement],
  );

  useEffect(() => {
    if (!open) {
      setQueue([]);
    }
  }, [open]);

  const previewUrls = useMemo(() => queue.map((f) => URL.createObjectURL(f)), [queue]);
  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewUrls]);

  useLayoutEffect(() => {
    if (queue.length > prevQueueLength.current) {
      const el = stripRef.current;
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'instant' });
    }
    prevQueueLength.current = queue.length;
  }, [queue.length]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    
    // We copy the files into an array so we can clear the input value safely
    const fileArray = Array.from(files);
    e.target.value = '';
    
    console.debug('[photo-verification] selected files:', fileArray.length);
    if (!taskUuid) {
      toast.error(v.noTaskBinding);
      return;
    }
    void (async () => {
      setPreparing(true);
      try {
        const prep = await prepareStaffVerificationFiles(fileArray);
        if (!prep.ok) {
          if (prep.error === 'too_many') {
            toast.error(v.tooMany(prep.maxFiles ?? MAX_STAFF_VERIFICATION_FILES));
          } else {
            toast.error(v.videoTooBig(prep.maxMb ?? 50));
          }
          return;
        }
        if (!prep.files.length) {
          toast.error(v.emptyAfterPrepare);
          return;
        }
        console.debug('[photo-verification] prepared files:', prep.files.length);
        setQueue((q) => {
          // Слева «+», выбранные файлы слева направо справа от кнопки.
          const merged = [...q, ...prep.files].slice(0, MAX_STAFF_VERIFICATION_FILES);
          if (q.length + prep.files.length > MAX_STAFF_VERIFICATION_FILES) {
            toast.message(v.tooMany(MAX_STAFF_VERIFICATION_FILES));
          }
          return merged;
        });
      } catch (err) {
        console.error('prepareStaffVerificationFiles', err);
        toast.error(v.prepareFailed);
      } finally {
        setPreparing(false);
      }
    })();
  };

  const send = async () => {
    if (!taskUuid || queue.length === 0) return;
    try {
      await upload({ uuid: taskUuid, files: queue });
      toast.success(variant === 'supplement' ? v.successSupplement : v.successDefault);
      onOpenChange(false);
    } catch (e) {
      const empty = e instanceof Error && e.message === 'TASK_PHOTO_UPLOAD_EMPTY';
      toast.error(
        empty
          ? 'Сервер не получил файл. Повторите или выберите другое фото / видео.'
          : e instanceof Error
            ? e.message || 'Не удалось загрузить'
            : 'Не удалось загрузить',
      );
    }
  };

  const busy = preparing || uploadMutationPending;
  const canSend = queue.length > 0 && !busy;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={title}>
        <p className="mb-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{description}</p>
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">{v.stripHint}</p>

        <div
          ref={stripRef}
          className={cn(
            'mb-4 flex w-full min-h-[7.5rem] snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1',
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          <label
            className={cn(
              'group relative flex h-28 w-24 shrink-0 snap-start flex-col items-center justify-center overflow-hidden',
              'rounded-2xl border-2 border-dashed border-teal-300/90 bg-gradient-to-br from-white to-teal-50/80',
              'text-teal-800 shadow-sm transition-all active:scale-[0.98] dark:from-slate-900/80 dark:to-teal-950/40 dark:border-teal-800 dark:text-teal-200',
              busy ? 'pointer-events-none opacity-50' : 'cursor-pointer',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={busy}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              onChange={handleFileInput}
            />
            <div className="relative z-0 mb-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <span className="relative z-0 px-1 text-center text-[11px] font-medium leading-tight">
              {preparing ? v.preparing : v.addFromGallery}
            </span>
          </label>

          {queue.map((f, i) => {
            const u = previewUrls[i];
            const isVid = isVideoFile(f);
            return (
              <div
                key={u || `${f.name}-${f.size}-${f.lastModified}-${i}`}
                className="relative h-28 w-24 shrink-0 snap-start overflow-hidden rounded-2xl ring-1 ring-slate-200/90 dark:ring-slate-600/80"
              >
                {isVid && u ? (
                  <video
                    src={u}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                    aria-label=""
                  />
                ) : isVid ? (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-slate-800 to-slate-950 text-white">
                    <Clapperboard className="h-7 w-7 opacity-90" />
                    <Video className="mt-0.5 h-4 w-4 opacity-60" />
                    <span className="mt-1 max-w-full truncate px-1 text-center text-[9px] font-medium text-white/80">
                      {f.name}
                    </span>
                  </div>
                ) : u ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
            );
          })}
        </div>

        {queue.length > 0 && (
          <p className="mb-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
            {queue.length} / {MAX_STAFF_VERIFICATION_FILES}
          </p>
        )}

        {queue.length > 0 ? (
          <Button
            className="h-12 w-full gap-2 rounded-2xl text-base shadow-md shadow-teal-900/10"
            size="lg"
            disabled={!canSend}
            onClick={() => void send()}
          >
            {uploadMutationPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
            {uploadMutationPending ? v.preparing : v.send}
          </Button>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
