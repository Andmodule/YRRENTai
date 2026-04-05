'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { TmaStaffTasksPage } from '@/modules/tma/components/TmaStaffTasksPage';

function Fallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background" aria-busy>
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

export default function TmaTasksRoutePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <TmaStaffTasksPage />
    </Suspense>
  );
}
