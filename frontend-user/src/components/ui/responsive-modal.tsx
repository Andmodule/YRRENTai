'use client';

import { createContext, useContext, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';

const MD_UP = '(min-width: 768px)';

export type ResponsiveModalDesktopPresentation = 'centered' | 'side';

const ResponsiveModalDesktopContext = createContext<boolean | undefined>(undefined);
const ResponsiveModalPresentationContext = createContext<ResponsiveModalDesktopPresentation>('centered');

/** Same boolean as `ResponsiveModal` / `ResponsiveModalContent` (avoids split Dialog vs Drawer). */
function useResponsiveModalIsDesktop(): boolean {
  const ctx = useContext(ResponsiveModalDesktopContext);
  const fallback = useMediaQuery(MD_UP);
  return ctx !== undefined ? ctx : fallback;
}

function useResponsiveModalPresentation(): ResponsiveModalDesktopPresentation {
  return useContext(ResponsiveModalPresentationContext);
}

export function ResponsiveModal({
  open,
  onOpenChange,
  children,
  /** Vaul snap heights (e.g. `['0.5', '0.92']`) — mobile drawer only. */
  drawerSnapPoints,
  /** Desktop: side panel (Sheet) vs centered Dialog. Default `centered`. */
  desktopPresentation = 'centered',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  drawerSnapPoints?: (number | string)[];
  desktopPresentation?: ResponsiveModalDesktopPresentation;
}) {
  const isDesktop = useMediaQuery(MD_UP);

  const desktopRoot =
    desktopPresentation === 'side' ? (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {children}
      </Sheet>
    ) : (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    );

  return (
    <ResponsiveModalPresentationContext.Provider value={desktopPresentation}>
      <ResponsiveModalDesktopContext.Provider value={isDesktop}>
        {isDesktop ? (
          desktopRoot
        ) : (
          <Drawer
            open={open}
            onOpenChange={onOpenChange}
            {...(drawerSnapPoints && drawerSnapPoints.length > 0 ? { snapPoints: drawerSnapPoints } : {})}
            modal
          >
            {children}
          </Drawer>
        )}
      </ResponsiveModalDesktopContext.Provider>
    </ResponsiveModalPresentationContext.Provider>
  );
}

export function ResponsiveModalTrigger(props: ComponentProps<typeof DialogTrigger>) {
  const isDesktop = useResponsiveModalIsDesktop();
  const presentation = useResponsiveModalPresentation();
  if (isDesktop) {
    return presentation === 'side' ? <SheetTrigger {...props} /> : <DialogTrigger {...props} />;
  }
  return <DrawerTrigger {...props} />;
}

interface ResponsiveModalContentProps {
  title: string;
  description?: string;
  /** Badges / meta below title (not in scroll body). */
  headerAdornment?: React.ReactNode;
  /** Mobile drawer: title row actions (e.g. edit + overflow). */
  headerActions?: React.ReactNode;
  /** Mobile drawer: no X — dismiss via swipe or overlay. */
  hideCloseButton?: boolean;
  children: React.ReactNode;
  /** Pinned at bottom; scroll stays in the main body. */
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Dialog/Drawer/Sheet root (portaled). Bind task accent tokens so primary is cyan, not global blue. */
  contentStyle?: CSSProperties;
  /** Desktop `Dialog` only: z-[200] so this opens above side sheets / drawers (z-[100]). */
  stackAboveTaskLayer?: boolean;
}

export function ResponsiveModalContent({
  title,
  description,
  headerAdornment,
  headerActions,
  hideCloseButton,
  children,
  footer,
  className,
  bodyClassName,
  contentStyle,
  stackAboveTaskLayer,
}: ResponsiveModalContentProps) {
  const isDesktop = useResponsiveModalIsDesktop();
  const presentation = useResponsiveModalPresentation();

  if (isDesktop && presentation === 'side') {
    return (
      <SheetContent
        title={title}
        description={description}
        headerAdornment={headerAdornment}
        footer={footer}
        className={className}
        bodyClassName={bodyClassName}
        style={contentStyle}
      >
        {children}
      </SheetContent>
    );
  }

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
        stackAboveTaskLayer={stackAboveTaskLayer}
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
      headerActions={headerActions}
      hideCloseButton={hideCloseButton}
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
  const isDesktop = useResponsiveModalIsDesktop();
  const presentation = useResponsiveModalPresentation();
  if (isDesktop) {
    return presentation === 'side' ? <SheetClose {...props} /> : <DialogClose {...props} />;
  }
  return <DrawerClose {...props} />;
}
