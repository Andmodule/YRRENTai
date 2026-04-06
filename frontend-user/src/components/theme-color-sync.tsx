'use client';

import { useTheme } from 'next-themes';
import { useLayoutEffect } from 'react';

/** Matches globals.css: light #ffffff, dark --background #111827 */
const THEME_COLOR_LIGHT = '#ffffff';
const THEME_COLOR_DARK = '#111827';

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useLayoutEffect(() => {
    const isDark =
      resolvedTheme === 'dark' ||
      (resolvedTheme === undefined && document.documentElement.classList.contains('dark'));
    const color = isDark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;

    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());

    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', color);
    document.head.appendChild(meta);
  }, [resolvedTheme]);

  return null;
}
