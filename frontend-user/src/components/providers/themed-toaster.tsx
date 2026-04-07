'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="top-center"
    />
  );
}
