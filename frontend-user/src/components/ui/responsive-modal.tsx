'use client';

import type { ComponentProps, CSSProperties, ReactNode } from 'react';
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
  /** Badges / meta below title (not in scroll body). */
  headerAdornment?: React.ReactNode;
  children: React.ReactNode;
  /** Pinned at bottom; scroll stays in the main body. */
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Dialog/Drawer root (portaled). Bind task accent tokens so primary is cyan, not global blue. */
  contentStyle?: CSSProperties;
}

export function ResponsiveModalContent({
  title,
  description,
  headerAdornment,
  children,
  footer,
  className,
  bodyClassName,
  contentStyle,
}: ResponsiveModalContentProps) {
  const isDesktop = useMediaQuery(MD_UP);
  if (isDesktop) {
    return (
      <DialogContent
        title={title}
        description={description}
        headerAdornment={headerAdornment}
        footer={footer}
        className={className}
        bodyClassName={bodyClassName}
        style={contentStyle}
      >
        {children}
      </DialogContent>
    );
  }
  return (
    <DrawerContent
      title={title}
      description={description}
      headerAdornment={headerAdornment}
      footer={footer}
      className={className}
      bodyClassName={bodyClassName}
      style={contentStyle}
    >
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
