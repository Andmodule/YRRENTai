'use client';

import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { isVideoAttachmentUrl } from '@/lib/media-url';

export function StaffMediaViewerDrawer({
  open,
  onOpenChange,
  title,
  urls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  urls: string[];
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={title} className="max-h-[min(88svh,720px)]">
        <div className="max-h-[min(70svh,560px)] space-y-3 overflow-y-auto pr-1">
          {urls.map((url) => (
            <div
              key={url}
              className="overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-950/5 dark:border-slate-700 dark:bg-slate-900/40"
            >
              {isVideoAttachmentUrl(url) ? (
                <video
                  src={url}
                  controls
                  playsInline
                  className="max-h-[min(50vh,360px)] w-full object-contain bg-black"
                  preload="metadata"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed/public URLs
                <img src={url} alt="" className="max-h-[min(50vh,360px)] w-full object-contain" />
              )}
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
