'use client';

import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '@/lib/utils';

export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;

export function DrawerContent({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <DrawerPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col rounded-t-2xl bg-white shadow-xl',
          className,
        )}
      >
        {/* Handle */}
        <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-gray-300" />
        {/* Header */}
        <div className="border-b border-gray-100 px-5 pb-4 pt-3">
          <DrawerPrimitive.Title className="text-lg font-semibold text-gray-900">
            {title}
          </DrawerPrimitive.Title>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}
