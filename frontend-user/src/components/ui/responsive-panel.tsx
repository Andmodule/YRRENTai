'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';

interface ResponsivePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

/** Sheet (desktop) / Drawer (mobile); closes when viewport crosses md breakpoint while open. */
export function ResponsivePanel({ open, onOpenChange, title, children }: ResponsivePanelProps) {
  const isMobile = useIsMobile();
  const prevMobile = useRef(isMobile);

  useEffect(() => {
    if (prevMobile.current !== isMobile && open) {
      onOpenChange(false);
    }
    prevMobile.current = isMobile;
  }, [isMobile, open, onOpenChange]);

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent title={title} className="h-[85vh] max-h-[85vh]">
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={title} className="w-[400px] max-w-[min(400px,100svw)] sm:max-w-[400px]">
        {children}
      </SheetContent>
    </Sheet>
  );
}
