'use client';

import { useMediaQuery } from 'usehooks-ts';

/** SSR-safe: first paint is desktop layout; updates after hydration. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)', {
    initializeWithValue: false,
    defaultValue: false,
  });
}
