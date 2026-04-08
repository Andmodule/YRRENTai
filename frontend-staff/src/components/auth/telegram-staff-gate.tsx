'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';

const TG_SCRIPT_SRC = 'https://telegram.org/js/telegram-web-app.js';

function applyTelegramTheme(wa: NonNullable<Window['Telegram']>['WebApp']) {
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* WebView quirks */
  }
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

type Surface = 'unknown' | 'browser' | 'telegram';

/**
 * В Telegram Mini App: `initData` → POST /auth/tma/login.
 * В обычном браузере: без блокировки.
 *
 * Загрузка через createElement + poll: в WebView Telegram `next/script` onLoad часто не срабатывает → белый экран.
 */
export function TelegramStaffGate({ children }: { children: React.ReactNode }) {
  const { user, mutate } = useAuth();
  const [scriptReady, setScriptReady] = useState(false);
  const [surface, setSurface] = useState<Surface>('unknown');
  const [tgPhase, setTgPhase] = useState<'idle' | 'working' | 'ready' | 'err'>('idle');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const tmaStarted = useRef(false);
  const scriptReadyRef = useRef(false);

  const markScriptReady = useCallback(() => {
    if (scriptReadyRef.current) return;
    scriptReadyRef.current = true;
    setScriptReady(true);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let cancelled = false;

    const tryFinish = () => {
      if (cancelled) return;
      if (window.Telegram?.WebApp) {
        markScriptReady();
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
        if (!cancelled) markScriptReady();
      };
      existing.onerror = () => {
        if (!cancelled) markScriptReady();
      };
      document.head.appendChild(existing);
    } else {
      existing.addEventListener('load', () => !cancelled && markScriptReady(), { once: true });
      existing.addEventListener('error', () => !cancelled && markScriptReady(), { once: true });
    }

    const poll = window.setInterval(() => {
      if (cancelled) return;
      if (tryFinish()) {
        window.clearInterval(poll);
      }
    }, 80);

    const maxWait = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!cancelled) markScriptReady();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(maxWait);
    };
  }, [markScriptReady]);

  useEffect(() => {
    if (!scriptReady) return;
    const init = window.Telegram?.WebApp?.initData?.trim() ?? '';
    if (!init) {
      setSurface('browser');
      return;
    }
    setSurface('telegram');
    applyTelegramTheme(window.Telegram!.WebApp);
  }, [scriptReady]);

  const runTmaLogin = useCallback(async () => {
    const initData = window.Telegram!.WebApp.initData.trim();
    setTgPhase('working');
    setLocalErr(null);
    try {
      await apiClient.post('/auth/tma/login', { initData });
      await mutate();
      setTgPhase('ready');
    } catch {
      setLocalErr(
        'Не удалось войти. Откройте приложение по ссылке-приглашению из бота Staff и привяжите Telegram к аккаунту персонала.',
      );
      setTgPhase('err');
    }
  }, [mutate]);

  useEffect(() => {
    if (surface !== 'telegram') return;
    if (tgPhase === 'err') return;

    if (user?.role === 'STAFF') {
      setTgPhase('ready');
      setLocalErr(null);
      return;
    }

    if (user && user.role !== 'STAFF') {
      setLocalErr('Этот Telegram-аккаунт не привязан к профилю персонала (ожидается роль Staff).');
      setTgPhase('err');
      return;
    }

    // Не ждём GET /users/me: при «висящем» API без таймаута Mini App был бы белым экраном навсегда.
    if (tmaStarted.current) return;
    tmaStarted.current = true;
    void runTmaLogin();
  }, [surface, user, tgPhase, runTmaLogin]);

  const showBlockingSpinner =
    !scriptReady ||
    surface === 'unknown' ||
    (surface === 'telegram' &&
      tgPhase !== 'ready' &&
      tgPhase !== 'err' &&
      (tgPhase === 'idle' || tgPhase === 'working'));

  let body: React.ReactNode;

  if (surface === 'browser') {
    body = children;
  } else if (showBlockingSpinner) {
    body = (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--tg-theme-bg-color,var(--background))] px-4 text-slate-800"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
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
        <p className="text-center text-sm text-slate-600" style={{ fontSize: 14, color: '#475569' }}>
          {!scriptReady ? 'Загрузка…' : 'Вход через Telegram…'}
        </p>
      </div>
    );
  } else if (surface === 'telegram' && tgPhase === 'err') {
    body = (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backgroundColor: '#f8fafc',
        }}
      >
        <p className="max-w-sm text-sm text-slate-600" style={{ fontSize: 14, color: '#475569' }}>
          {localErr ?? 'Ошибка входа'}
        </p>
        <button
          type="button"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm"
          style={{
            border: '1px solid #e2e8f0',
            background: '#fff',
            padding: '8px 16px',
            borderRadius: 12,
            fontSize: 14,
          }}
          onClick={() => window.Telegram?.WebApp?.close()}
        >
          Закрыть
        </button>
      </div>
    );
  } else {
    body = (
      <div className="min-h-dvh bg-[var(--tg-theme-bg-color,var(--background))] text-[var(--tg-theme-text-color,var(--foreground))]">
        {children}
      </div>
    );
  }

  return <>{body}</>;
}
