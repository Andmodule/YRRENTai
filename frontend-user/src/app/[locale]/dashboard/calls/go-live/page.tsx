'use client';

import { useVoiceReadiness, useRunVoiceSmokeTests } from '@/hooks/use-calls-admin';
import { useAuth } from '@/hooks/use-auth';
import { redirect } from 'next/navigation';
import { useParams } from 'next/navigation';
import type { SmokeTestReport } from '@/lib/api/calls-admin';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import { ReadinessStatusCard }  from '@/modules/calls/components/go-live/ReadinessStatusCard';
import { ReadinessChecksList }  from '@/modules/calls/components/go-live/ReadinessChecksList';
import { SmokeTestPanel }       from '@/modules/calls/components/go-live/SmokeTestPanel';
import { PilotLaunchPanel }     from '@/modules/calls/components/go-live/PilotLaunchPanel';
import { FirstCallChecklist }   from '@/modules/calls/components/go-live/FirstCallChecklist';

export default function GoLivePage() {
  const { user } = useAuth();
  const params = useParams();
  const locale = (params?.locale as string) ?? 'ru';

  if (!user || (user.role !== 'OWNER' && user.role !== 'MANAGER')) {
    redirect(`/${locale}/dashboard`);
  }

  const { data: readiness, isLoading, error, refetch, isFetching } = useVoiceReadiness();
  const smokeTestMutation = useRunVoiceSmokeTests();
  const [smokeReport, setSmokeReport] = useState<SmokeTestReport | undefined>(undefined);

  const handleSmokeTest = async () => {
    const report = await smokeTestMutation.mutateAsync();
    setSmokeReport(report);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !readiness) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Не удалось загрузить readiness report.{' '}
            <button onClick={() => refetch()} className="underline hover:no-underline">
              Повторить
            </button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ── Content ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Page title */}
      <div>
        <h1 className="text-lg font-bold text-foreground">Go-Live Readiness</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Проверка готовности системы к пилотному запуску голосового AI
        </p>
      </div>

      {/* Top-level status banner */}
      {readiness.overallStatus === 'blocked' && (
        <Alert variant="destructive" className="bg-red-950/40 border-red-700/50">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-red-300">
            Система не готова к запуску — устраните критические ошибки ниже.
          </AlertDescription>
        </Alert>
      )}

      {readiness.overallStatus === 'warning' && (
        <Alert className="bg-amber-950/30 border-amber-700/40">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <AlertDescription className="text-amber-300">
            Есть предупреждения — запуск возможен, но некоторые функции могут не работать.
          </AlertDescription>
        </Alert>
      )}

      {readiness.overallStatus === 'ready' && (
        <Alert className="bg-teal-950/40 border-teal-700/40">
          <CheckCircle2 className="h-4 w-4 text-teal-400" />
          <AlertDescription className="text-teal-300">
            Все проверки пройдены — система готова к пилоту. Перейдите в Rollout для включения.
          </AlertDescription>
        </Alert>
      )}

      {/* Status card */}
      <ReadinessStatusCard
        readiness={readiness}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
      />

      {/* Two column layout on larger screens */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ReadinessChecksList readiness={readiness} />
        </div>
      </div>

      {/* First call checklist */}
      <FirstCallChecklist readiness={readiness} />

      {/* Smoke tests + Pilot panel side-by-side on wider screens */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SmokeTestPanel
          report={smokeReport}
          isRunning={smokeTestMutation.isPending}
          onRun={handleSmokeTest}
        />
        <PilotLaunchPanel readiness={readiness} />
      </div>
    </div>
  );
}
