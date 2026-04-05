'use client';

import { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';

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
  const { user, isLoading, mutate } = useAuth();
  const [scriptReady, setScriptReady] = useState(false);
  const [phase, setPhase] = useState<'boot' | 'logging' | 'ready' | 'err'>('boot');
  const [localErr, setLocalErr] = useState<string | null>(null);

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
    if (!scriptReady || isLoading) return;

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

    void runLogin();
  }, [scriptReady, isLoading, user, runLogin, t]);

  const showSpinner =
    !scriptReady || phase === 'boot' || phase === 'logging' || isLoading;

  if (showSpinner) {
    return (
      <>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
        <div
          className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--tg-theme-bg-color,hsl(var(--background)))] px-4 text-foreground"
          aria-busy
        >
          <Loader2 className="h-8 w-8 animate-spin opacity-70" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {!scriptReady ? t('telegramScript') : t('loading')}
          </p>
        </div>
      </>
    );
  }

  if (phase === 'err' || !user || user.role !== 'STAFF') {
    return (
      <>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
        <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-background px-4 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{localErr ?? t('loginFailed')}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div
        className={cn(
          'tma-root min-h-dvh bg-[var(--tg-theme-bg-color,hsl(var(--background)))]',
          'text-[var(--tg-theme-text-color,hsl(var(--foreground)))]',
        )}
      >
        {children}
      </div>
    </>
  );
}
