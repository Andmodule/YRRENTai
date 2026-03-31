import { cn } from '@/lib/utils';

/** Shared auth form input look: white field, gray border, dark focus ring (overrides ui/input defaults). */
export function authInputClass(hasError: boolean) {
  return cn(
    'h-auto w-full rounded-xl border px-4 py-3 text-base transition-colors duration-200 ease-in-out outline-none',
    'bg-white placeholder:text-gray-400',
    'focus-visible:outline-none focus-visible:ring-offset-0',
    'disabled:cursor-not-allowed disabled:opacity-50',
    hasError
      ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-4 focus-visible:ring-red-200'
      : 'border-gray-300 focus:border-gray-900 focus-visible:border-gray-900 focus:ring-4 focus:ring-gray-900/5 focus-visible:ring-4 focus-visible:ring-gray-900/5',
  );
}

/** Dark panel (slate) auth inputs — right column on login/register/forgot. */
export function authDarkInputClass(hasError: boolean) {
  return cn(
    'h-auto w-full rounded-xl border px-4 py-3 text-base transition-colors duration-200 ease-in-out outline-none',
    'bg-slate-900/50 text-white placeholder:text-slate-500',
    'focus-visible:outline-none focus-visible:ring-offset-0',
    'disabled:cursor-not-allowed disabled:opacity-50',
    hasError
      ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-4 focus-visible:ring-red-500/20'
      : 'border-slate-600 focus:border-blue-500 focus-visible:border-blue-500 focus-visible:bg-slate-900/70 focus-visible:ring-4 focus-visible:ring-blue-500/15',
  );
}
