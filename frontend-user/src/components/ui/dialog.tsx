'use client';

import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

interface DialogContentProps extends RadixDialog.DialogContentProps {
  title: string;
  description?: string;
  /** Pinned below scroll area (e.g. action buttons). */
  footer?: ReactNode;
}

export function DialogContent({ title, description, children, footer, className, ...props }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-[100] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <RadixDialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[100] flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          'max-h-[min(90dvh,90vh)] overflow-hidden',
          'rounded-lg border bg-background shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
          'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          'mx-4 max-sm:mx-3',
          className,
        )}
        {...props}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 p-6 pb-4">
          <div className="min-w-0">
            <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close className="ml-2 shrink-0 rounded-sm opacity-70 ring-offset-background transition-opacity duration-200 ease-in-out hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-background px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
