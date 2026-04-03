'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/use-media-query';

const MD_UP = '(min-width: 768px)';

export function ResponsiveModal({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const isDesktop = useMediaQuery(MD_UP);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {children}
    </Drawer>
  );
}

export function ResponsiveModalTrigger(props: ComponentProps<typeof DialogTrigger>) {
  const isDesktop = useMediaQuery(MD_UP);
  if (isDesktop) {
    return <DialogTrigger {...props} />;
  }
  return <DrawerTrigger {...props} />;
}

interface ResponsiveModalContentProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Pinned at bottom; scroll stays in the main body. */
  footer?: React.ReactNode;
  className?: string;
}

export function ResponsiveModalContent({
  title,
  description,
  children,
  footer,
  className,
}: ResponsiveModalContentProps) {
  const isDesktop = useMediaQuery(MD_UP);
  if (isDesktop) {
    return (
      <DialogContent title={title} description={description} footer={footer} className={className}>
        {children}
      </DialogContent>
    );
  }
  return (
    <DrawerContent title={title} description={description} footer={footer} className={className}>
      {children}
    </DrawerContent>
  );
}

export function ResponsiveModalClose(props: ComponentProps<typeof DialogClose>) {
  const isDesktop = useMediaQuery(MD_UP);
  if (isDesktop) {
    return <DialogClose {...props} />;
  }
  return <DrawerClose {...props} />;
}
