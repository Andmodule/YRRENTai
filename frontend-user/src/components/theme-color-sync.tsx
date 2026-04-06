'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

/** Matches globals.css --background: light #ffffff intent, dark #111827 */
const THEME_COLOR_LIGHT = '#ffffff';
const THEME_COLOR_DARK = '#111827';

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
  }, [resolvedTheme]);

  return null;
}
