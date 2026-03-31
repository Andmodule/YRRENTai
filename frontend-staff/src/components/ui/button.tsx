import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default:
    'bg-teal-600 text-white shadow-md shadow-teal-600/20 hover:bg-teal-500 active:scale-[0.98]',
  outline:
    'border border-slate-200 bg-white/90 text-slate-800 hover:bg-slate-50 hover:border-slate-300',
  ghost: 'text-slate-700 hover:bg-slate-100/80',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
  destructive: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
} as const;

const sizes = {
  default: 'h-10 px-4 py-2 text-sm',
  sm: 'h-8 px-3 py-1 text-xs',
  lg: 'h-12 px-6 py-3 text-base',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
