'use client';

import { cn } from '@/lib/utils';

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('border-0 border-t border-border', className)} {...props} />;
}
