'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR snapshot: mobile (`Drawer`) first so server HTML matches the phone drawer and avoids Dialog/Drawer
 * hydration mismatch. After hydration, desktop gets the centered `Dialog` from matchMedia.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
