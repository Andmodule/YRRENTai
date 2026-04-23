'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'rentai.staff.theme';

export type StaffThemeMode = 'light' | 'dark';

function readStored(): StaffThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* private mode */
  }
  return 'light';
}

function applyToDocument(mode: StaffThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

type StaffThemeContextValue = {
  mode: StaffThemeMode;
  setMode: (m: StaffThemeMode) => void;
  toggle: () => void;
};

const StaffThemeContext = createContext<StaffThemeContextValue | null>(null);

export function StaffThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<StaffThemeMode>('light');

  useEffect(() => {
    setModeState(readStored());
  }, []);

  useEffect(() => {
    applyToDocument(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const setMode = useCallback((m: StaffThemeMode) => {
    setModeState(m);
  }, []);

  const toggle = useCallback(() => {
    setModeState((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);

  return <StaffThemeContext.Provider value={value}>{children}</StaffThemeContext.Provider>;
}

export function useStaffTheme(): StaffThemeContextValue {
  const ctx = useContext(StaffThemeContext);
  if (!ctx) {
    throw new Error('useStaffTheme must be used within StaffThemeProvider');
  }
  return ctx;
}
