'use client';

import { cn } from '@/lib/utils';

export function Alert({
  variant = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border p-4',
        variant === 'destructive' && 'border-destructive/50 bg-destructive/10 text-destructive',
        variant === 'default' && 'border-border bg-muted/30',
        className,
      )}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm', className)} {...props} />;
}
