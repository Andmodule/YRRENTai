import type { Theme } from 'planby';

/** Planby reads `theme.primary[900]` for ScrollBox, Content, ChannelBox, sticky sidebar — must match app `--card` in each mode. */
export function getCalendarPlanbyTheme(isDark: boolean): Theme {
  if (isDark) {
    return {
      primary: { 600: '#334155', 900: '#0f172a' },
      grey: { 300: '#475569' },
      white: '#0f172a',
      green: { 300: '#34d399' },
      loader: {
        teal: '#2dd4bf',
        purple: '#a78bfa',
        pink: '#f472b6',
        bg: '#0f172acc',
      },
      scrollbar: {
        border: '#0f172a',
        thumb: { bg: '#64748b' },
      },
      gradient: {
        blue: { 300: '#60a5fa', 600: '#2563eb', 900: '#1e3a8a' },
      },
      text: {
        grey: { 300: '#94a3b8', 500: '#cbd5e1' },
      },
      timeline: {
        divider: { bg: '#475569' },
      },
    };
  }

  return {
    primary: { 600: '#e2e8f0', 900: '#f8fafc' },
    grey: { 300: '#cbd5e1' },
    white: '#ffffff',
    green: { 300: '#86efac' },
    loader: { teal: '#0d9488', purple: '#7c3aed', pink: '#db2777', bg: '#f1f5f9' },
    scrollbar: { border: '#e2e8f0', thumb: { bg: '#94a3b8' } },
    gradient: { blue: { 300: '#93c5fd', 600: '#3b82f6', 900: '#1e3a8a' } },
    text: { grey: { 300: '#64748b', 500: '#475569' } },
    timeline: { divider: { bg: '#e2e8f0' } },
  };
}
