'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const TG_SCRIPT_SRC = 'https://telegram.org/js/telegram-web-app.js';

/**
 * Telegram WebView often never fires `next/script` onLoad → scriptReady stuck false → blank UI.
 * Same approach as `frontend-staff` TelegramStaffGate: poll WebApp, inject script, hard timeout.
 */
function useTelegramWebAppScriptReady(): boolean {
  const [scriptReady, setScriptReady] = useState(false);
  const doneRef = useRef(false);

  const markReady = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setScriptReady(true);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let cancelled = false;

    const tryFinish = () => {
      if (cancelled) return;
      if (window.Telegram?.WebApp) {
        markReady();
        return true;
      }
      return false;
    };

    if (tryFinish()) {
      return () => {
        cancelled = true;
      };
    }

    let existing = document.querySelector(
      'script[src*="telegram-web-app.js"]',
    ) as HTMLScriptElement | null;
    if (!existing) {
      existing = document.createElement('script');
      existing.src = TG_SCRIPT_SRC;
      existing.async = true;
      existing.onload = () => {
        if (!cancelled) markReady();
      };
      existing.onerror = () => {
        if (!cancelled) markReady();
      };
      document.head.appendChild(existing);
    } else {
      existing.addEventListener('load', () => !cancelled && markReady(), { once: true });
      existing.addEventListener('error', () => !cancelled && markReady(), { once: true });
    }

    const poll = window.setInterval(() => {
      if (cancelled) return;
      if (tryFinish()) window.clearInterval(poll);
    }, 80);

    const maxWait = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!cancelled) markReady();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(maxWait);
    };
  }, [markReady]);

  return scriptReady;
}

function applyTelegramTheme(wa: {
  themeParams: Partial<Record<string, string>>;
  ready: () => void;
  expand: () => void;
}) {
  wa.ready();
  wa.expand();
  const p = wa.themeParams;
  const root = document.documentElement;
  if (p.bg_color) root.style.setProperty('--tg-theme-bg-color', p.bg_color);
  if (p.text_color) root.style.setProperty('--tg-theme-text-color', p.text_color);
  if (p.hint_color) root.style.setProperty('--tg-theme-hint-color', p.hint_color);
  if (p.link_color) root.style.setProperty('--tg-theme-link-color', p.link_color);
  if (p.button_color) root.style.setProperty('--tg-theme-button-color', p.button_color);
  if (p.button_text_color) root.style.setProperty('--tg-theme-button-text-color', p.button_text_color);
  if (p.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color', p.secondary_bg_color);
}

export function TmaLayoutRoot({ children }: { children: React.ReactNode }) {
  const t = useTranslations('tma');
  const { user, mutate } = useAuth();
  const scriptReady = useTelegramWebAppScriptReady();
  const [phase, setPhase] = useState<'boot' | 'logging' | 'ready' | 'err'>('boot');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const tmaLoginStarted = useRef(false);

  const runLogin = useCallback(async () => {
    const wa = window.Telegram?.WebApp;
    if (!wa) {
      setLocalErr(t('needTelegram'));
      setPhase('err');
      return;
    }
    applyTelegramTheme(wa);
    const initData = wa.initData?.trim() ?? '';
    if (!initData) {
      setLocalErr(t('needTelegram'));
      setPhase('err');
      return;
    }
    setPhase('logging');
    setLocalErr(null);
    try {
      await apiClient.post('/auth/tma/login', { initData });
      await mutate();
      setPhase('ready');
    } catch {
      setLocalErr(t('loginFailed'));
      setPhase('err');
    }
  }, [mutate, t]);

  useEffect(() => {
    if (!scriptReady) return;

    if (user?.role === 'STAFF') {
      const wa = window.Telegram?.WebApp;
      if (wa) applyTelegramTheme(wa);
      setPhase('ready');
      setLocalErr(null);
      return;
    }

    if (user && user.role !== 'STAFF') {
      setLocalErr(t('staffOnly'));
      setPhase('err');
      return;
    }

    /** Do not wait for GET /users/me: hanging request left the Mini App on spinner forever. */
    if (tmaLoginStarted.current) return;
    tmaLoginStarted.current = true;
    void runLogin();
  }, [scriptReady, user, runLogin, t]);

  const showSpinner =
    !scriptReady || phase === 'boot' || phase === 'logging';

  if (showSpinner) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4"
        style={{
          minHeight: '100dvh',
          backgroundColor: 'var(--tg-theme-bg-color, #f0f4f8)',
          color: '#0f172a',
        }}
        aria-busy
      >
        <Loader2
          className="h-8 w-8 animate-spin text-teal-600"
          style={{ width: 32, height: 32, color: '#0d9488' }}
          aria-hidden
        />
        <p className="text-center text-sm" style={{ fontSize: 14, color: '#475569' }}>
          {!scriptReady ? t('telegramScript') : t('loading')}
        </p>
      </div>
    );
  }

  if (phase === 'err' || !user || user.role !== 'STAFF') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center"
        style={{ minHeight: '100dvh', backgroundColor: '#f8fafc' }}
      >
        <p className="max-w-sm text-sm" style={{ fontSize: 14, color: '#475569' }}>
          {localErr ?? t('loginFailed')}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'tma-root min-h-dvh bg-[var(--tg-theme-bg-color,hsl(var(--background)))]',
        'text-[var(--tg-theme-text-color,hsl(var(--foreground)))]',
      )}
    >
      {children}
    </div>
  );
}
