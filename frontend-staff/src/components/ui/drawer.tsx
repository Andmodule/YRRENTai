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
  /** По умолчанию p-5; для списков карточек можно задать px-4 pt-2 pb-6 и т.д. */
  bodyClassName,
}: {
  children: React.ReactNode;
  title: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <DrawerPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col rounded-t-[1.25rem] border border-slate-200/80 bg-white text-slate-900 shadow-2xl shadow-slate-900/[0.08] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100',
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300/80 dark:bg-slate-600" />
        <div className="border-b border-slate-100 px-5 pb-3 pt-1.5 dark:border-slate-800">
          <DrawerPrimitive.Title className="text-lg font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-100">
            {title}
          </DrawerPrimitive.Title>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 text-base text-slate-900 dark:text-slate-100',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}
