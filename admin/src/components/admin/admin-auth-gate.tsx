'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';

type GateState = 'loading' | 'ready';

/**
 * SUPERADMIN check runs in the browser (same-origin `/api/v1` + cookies).
 * Edge middleware cannot reliably reuse session cookies for internal fetches.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get<{ data: { role: string } }>('/users/me');
        const role = data?.data?.role;
        if (cancelled) return;
        if (role !== 'SUPERADMIN') {
          await apiClient.post('/auth/logout').catch(() => {});
          router.replace('/login');
          return;
        }
        setState('ready');
      } catch {
        if (cancelled) return;
        router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state !== 'ready') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <span className="text-sm">Loading…</span>
      </div>
    );
  }
  return <>{children}</>;
}
