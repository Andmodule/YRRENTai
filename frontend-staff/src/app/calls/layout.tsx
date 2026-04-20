'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CallsNav } from '@/components/calls/CallsNav';
import { apiClient } from '@/lib/api/client';
import { useSWRConfig } from 'swr';

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated, isCallsAdmin, mutate: mutateAuth } = useAuth();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!isCallsAdmin) {
      // Staff (cleaners/drivers) don't have access to calls admin
      router.replace('/tasks');
    }
  }, [isLoading, isAuthenticated, isCallsAdmin, router]);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      await globalMutate('staff-auth/me', undefined, { revalidate: false });
      router.replace('/login');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <aside className="w-48 border-r border-slate-200 p-3 flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
        </aside>
        <main className="flex-1 p-6">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-64 rounded-xl" />
        </main>
      </div>
    );
  }

  if (!isAuthenticated || !isCallsAdmin) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar — desktop only header */}
      <header className="hidden md:flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0 z-10">
        <div className="flex items-center gap-2.5">
          <Phone className="h-4.5 w-4.5 text-teal-600" />
          <span className="font-semibold text-slate-800 text-sm">Voice Admin</span>
          <span className="rounded-full bg-slate-100 text-slate-500 text-xs px-2 py-0.5">
            {user?.firstName} {user?.lastName}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleLogout()}
          className="gap-1.5 text-slate-500 text-xs"
        >
          <LogOut className="h-3.5 w-3.5" />
          Выйти
        </Button>
      </header>

      {/* Mobile: horizontal tab nav */}
      <div className="md:hidden shrink-0">
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-teal-600" />
            <span className="font-semibold text-slate-800 text-sm">Звонки</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleLogout()}
            className="h-8 w-8 text-slate-400 p-0"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CallsNav variant="tabs" />
      </div>

      {/* Desktop: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <aside className="hidden md:flex flex-col w-48 shrink-0 bg-white border-r border-slate-200">
          <CallsNav variant="sidebar" className="flex-1 pt-2" />
        </aside>

        {/* Page content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
