'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerPortal = DrawerPrimitive.Portal;

export function DrawerOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-[100] bg-black/50',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> {
  title: string;
  description?: string;
  /** Pinned below scroll area (e.g. action buttons). */
  footer?: React.ReactNode;
}

export function DrawerContent({ title, description, children, footer, className, ...props }: DrawerContentProps) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-[100] flex max-h-[min(92dvh,92vh)] flex-col rounded-t-lg border bg-background shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          className,
        )}
        {...props}
      >
        <DrawerPrimitive.Handle className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
        <div className="flex items-start justify-between gap-3 border-b px-6 pb-4 pt-2">
          <div className="min-w-0 flex-1">
            <DrawerPrimitive.Title className="text-lg font-semibold leading-tight">{title}</DrawerPrimitive.Title>
            {description && (
              <DrawerPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DrawerPrimitive.Description>
            )}
          </div>
          <DrawerPrimitive.Close className="ml-2 shrink-0 rounded-sm opacity-70 ring-offset-background transition-colors duration-200 ease-in-out hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DrawerPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-background px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}
