'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAxiosError } from 'axios';
import { Loader2, Play, Sparkles } from 'lucide-react';
import { fetchIntentTestExamples, postIntentTest } from '@/lib/api/ai-intent-test';
import { useProperties } from '@/hooks/use-properties';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { IntentTestDryRunResult, IntentTestExample } from '@/types/ai-intent-test';
import { cn } from '@/lib/utils';

const ROLES: IntentTestExample['senderRole'][] = ['GUEST', 'STAFF', 'SYSTEM', 'MANAGER'];

export function IntentTestPanel() {
  const t = useTranslations('automations.intentTest');
  const { properties, isLoading: propsLoading } = useProperties();
  const [propertyId, setPropertyId] = useState('');
  const [senderRole, setSenderRole] = useState<IntentTestExample['senderRole']>('GUEST');
  const [text, setText] = useState('');
  const [skipGate, setSkipGate] = useState(true);
  const [examples, setExamples] = useState<IntentTestExample[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IntentTestDryRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    const first = properties[0];
    if (!propertyId && first) setPropertyId(first.id);
  }, [properties, propertyId]);

  const loadExamples = useCallback(async () => {
    setExamplesError(null);
    setLoadingExamples(true);
    try {
      const data = await fetchIntentTestExamples();
      setExamples(data);
    } catch (e) {
      const msg = isAxiosError(e)
        ? (e.response?.data as { message?: string })?.message ?? e.message
        : t('errorGeneric');
      setExamplesError(String(msg));
    } finally {
      setLoadingExamples(false);
    }
  }, [t]);

  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  const applyExample = useCallback((ex: IntentTestExample) => {
    setSenderRole(ex.senderRole);
    setText(ex.text);
  }, []);

  const onRun = useCallback(async () => {
    if (!propertyId.trim()) return;
    setRunError(null);
    setResult(null);
    setRunning(true);
    try {
      const data = await postIntentTest({
        propertyId: propertyId.trim(),
        senderRole,
        text,
        skipActiveRulesGate: skipGate,
      });
      setResult(data);
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 403) {
        setRunError(t('forbidden'));
      } else {
        const msg = isAxiosError(e)
          ? (e.response?.data as { message?: string })?.message ?? e.message
          : t('errorGeneric');
        setRunError(String(msg));
      }
    } finally {
      setRunning(false);
    }
  }, [propertyId, senderRole, text, skipGate, t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Alert className="flex gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">{t('hintTitle')}</p>
          <AlertDescription className="mt-1 text-muted-foreground">{t('hintBody')}</AlertDescription>
        </div>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="space-y-2">
            <Label htmlFor="intent-test-property">{t('propertyLabel')}</Label>
            <Select
              id="intent-test-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              disabled={propsLoading || properties.length === 0}
            >
              <option value="">{propsLoading ? t('loadingProperties') : t('pickProperty')}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.id}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intent-test-role">{t('roleLabel')}</Label>
            <Select
              id="intent-test-role"
              value={senderRole}
              onChange={(e) => setSenderRole(e.target.value as IntentTestExample['senderRole'])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t('roleHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intent-test-text">{t('messageLabel')}</Label>
            <Textarea
              id="intent-test-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={t('messagePlaceholder')}
              className="resize-y"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-1 py-1 hover:bg-muted/40">
            <Checkbox checked={skipGate} onCheckedChange={(v) => setSkipGate(v === true)} className="mt-0.5" />
            <span>
              <span className="text-sm font-medium text-foreground">{t('skipGateLabel')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t('skipGateHint')}</span>
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void onRun()} disabled={running || !propertyId}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {t('running')}
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" aria-hidden />
                  {t('run')}
                </>
              )}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadExamples()} disabled={loadingExamples}>
              {loadingExamples ? t('loadingExamples') : t('reloadExamples')}
            </Button>
          </div>

          {examplesError && (
            <p className="text-sm text-destructive" role="alert">
              {examplesError}
            </p>
          )}

          {examples.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('samplesTitle')}</p>
              <div className="flex flex-wrap gap-2">
                {examples.map((ex) => (
                  <Button
                    key={ex.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-auto max-w-full whitespace-normal py-1.5 text-left text-xs"
                    onClick={() => applyExample(ex)}
                  >
                    {ex.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-[280px] space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <h2 className="text-sm font-semibold text-foreground">{t('resultTitle')}</h2>

          {runError && (
            <Alert variant="destructive">
              <AlertDescription>{runError}</AlertDescription>
            </Alert>
          )}

          {!result && !runError && (
            <p className="text-sm text-muted-foreground">{t('resultEmpty')}</p>
          )}

          {result && (
            <div className="space-y-3">
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  result.llmError || result.stoppedAt
                    ? 'border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
                    : 'border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100',
                )}
              >
                <p className="font-medium leading-snug">{result.summary}</p>
              </div>

              <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">{t('fieldActiveRules')}</dt>
                  <dd>{result.activeAutomationRulesCount}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">{t('fieldWouldEmit')}</dt>
                  <dd>{result.wouldEmitAiIntentDetected ? t('yes') : t('no')}</dd>
                </div>
                {result.llm && (
                  <>
                    <div>
                      <dt className="font-medium text-foreground">{t('fieldIntent')}</dt>
                      <dd className="font-mono text-foreground">{result.llm.intentKey}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">{t('fieldLatency')}</dt>
                      <dd>
                        {result.llm.latencyMs} ms · {result.llm.model}
                      </dd>
                    </div>
                  </>
                )}
                {result.matchingActiveRule && (
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-foreground">{t('fieldRule')}</dt>
                    <dd className="font-mono text-foreground">
                      {result.matchingActiveRule.key} ({result.matchingActiveRule.id.slice(0, 8)}…)
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="font-medium text-foreground">{t('fieldExecutor')}</dt>
                  <dd>{result.automationExecutorImplemented ? t('yes') : t('no')}</dd>
                </div>
              </dl>

              <details className="rounded-md border border-border bg-background/80 p-2">
                <summary className="cursor-pointer text-xs font-medium text-foreground">{t('rawJson')}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
