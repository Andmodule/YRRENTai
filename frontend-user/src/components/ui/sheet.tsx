'use client';

import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

interface SheetContentProps extends RadixDialog.DialogContentProps {
  title: string;
  description?: string;
  /** Pinned below the scroll area (e.g. action buttons) — always visible on mobile and desktop. */
  footer?: ReactNode;
}

export function SheetContent({ title, description, children, footer, className, ...props }: SheetContentProps) {
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
        {...props}
      >
        <div className="flex shrink-0 items-start justify-between border-b px-4 py-3 sm:px-5 sm:py-3.5">
          <div>
            <RadixDialog.Title className="text-base font-semibold leading-tight sm:text-lg">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-3">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-5">
            {footer}
          </div>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
