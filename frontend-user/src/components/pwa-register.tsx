'use client';

import { useEffect } from 'react';

/**
 * Registers `public/sw.js` for installable PWA / offline shell (pass-through to network).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore registration errors (localhost http, blocked SW, etc.) */
    });
  }, []);

  return null;
}
