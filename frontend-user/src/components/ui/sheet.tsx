'use client';

import type { CSSProperties, ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalNestedPortalProvider } from '@/components/ui/modal-nested-portal';

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

interface SheetContentProps extends RadixDialog.DialogContentProps {
  title: string;
  description?: string;
  /** Below title row (badges, meta) — same pattern as `DialogContent`. */
  headerAdornment?: ReactNode;
  /** Pinned below the scroll area (e.g. action buttons) — always visible on mobile and desktop. */
  footer?: ReactNode;
  bodyClassName?: string;
  style?: CSSProperties;
}

export function SheetContent({
  title,
  description,
  headerAdornment,
  children,
  footer,
  className,
  bodyClassName,
  style,
  ...props
}: SheetContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-[100] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <RadixDialog.Content
        className={cn(
          'fixed inset-y-0 right-0 z-[100] flex h-full w-full max-w-md flex-col border-l bg-background shadow-lg duration-300 ease-out',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          className,
        )}
        style={style}
        {...props}
      >
        <ModalNestedPortalProvider>
          <div className="flex shrink-0 flex-col border-b border-border/60">
            <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
              <div className="min-w-0">
                <RadixDialog.Title className="text-base font-semibold leading-tight sm:text-lg">{title}</RadixDialog.Title>
                {description && (
                  <RadixDialog.Description className="mt-1 max-w-[min(100%,42rem)] text-[11px] leading-snug text-muted-foreground/90">
                    {description}
                  </RadixDialog.Description>
                )}
              </div>
              <RadixDialog.Close className="ml-2 shrink-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </RadixDialog.Close>
            </div>
            {headerAdornment ? <div className="px-4 pb-3 sm:px-5">{headerAdornment}</div> : null}
          </div>
          <div
            className={cn(
              'min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-3',
              bodyClassName,
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-5">
              {footer}
            </div>
          ) : null}
        </ModalNestedPortalProvider>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
