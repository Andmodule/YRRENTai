'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';

/**
 * If the user already has a valid SUPERADMIN session, skip the login form.
 */
export function LoginRedirectIfSuperadmin({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get<{ data: { role: string } }>('/users/me');
        if (cancelled) return;
        if (data?.data?.role === 'SUPERADMIN') {
          router.replace('/');
          return;
        }
      } catch {
        // not logged in or invalid session
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <span className="text-sm">Checking session…</span>
      </div>
    );
  }
  return <>{children}</>;
}
