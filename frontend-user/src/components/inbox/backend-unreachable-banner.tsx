'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

export function BackendUnreachableBanner() {
  const t = useTranslations('inbox');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:3010';

  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2">
          <p className="font-medium text-destructive">{t('backendUnreachable')}</p>
          <p className="text-muted-foreground">{t('backendUnreachableHint', { apiUrl })}</p>
          <p className="font-mono text-xs text-muted-foreground">
            <span className="select-all">pnpm dev:backend</span>
            {' · '}
            <span className="select-all">{apiUrl}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
