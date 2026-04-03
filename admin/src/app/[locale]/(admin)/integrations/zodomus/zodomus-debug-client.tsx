'use client';

import { useCallback, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api/client';
import { Copy, Play, Trash2 } from 'lucide-react';

export interface AdminPropertyRow {
  id: string;
  name: string;
  zodomusPropertyId: string | null;
  zodomusRoomId: string | null;
  ownerEmail: string | null;
}

interface LogEntry {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestPreview: string;
  responsePreview: string;
  tab: 'response' | 'request' | 'headers';
}

const fetcher = async (url: string) => {
  const res = await apiClient.get<{ data: AdminPropertyRow[] }>(url);
  return res.data.data;
};

function SectionHelp({ text }: { text: string }) {
  return <p className="mt-2 text-xs text-zinc-500 leading-relaxed whitespace-pre-line">{text}</p>;
}

export default function ZodomusDebugClient() {
  const t = useTranslations('zodomusDebug');
  const { data: properties = [], isLoading: propsLoading, error: propsError } = useSWR(
    '/admin/properties',
    fetcher,
  );

  const [propertyId, setPropertyId] = useState('');
  const [channelId, setChannelId] = useState('1');
  const [force, setForce] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [webhookKey, setWebhookKey] = useState('');
  const [webhookReservationId, setWebhookReservationId] = useState('1234567');
  const [webhookStatus, setWebhookStatus] = useState('1');
  const [createTestStatus, setCreateTestStatus] = useState<'new' | 'modified' | 'cancelled' | 'summary'>(
    'new',
  );
  const [createTestReservationIdOpt, setCreateTestReservationIdOpt] = useState('');
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [priceModelId, setPriceModelId] = useState('2');

  const selected = useMemo(
    () => properties.find((p) => p.id === propertyId),
    [properties, propertyId],
  );

  const canUseZodomusProperty = Boolean(propertyId && selected?.zodomusPropertyId?.trim());
  const priceModelIdNum = Number(priceModelId);
  const priceModelOk =
    Number.isFinite(priceModelIdNum) && priceModelIdNum >= 1 && priceModelIdNum <= 5;

  const pushLog = useCallback(
    (
      method: string,
      path: string,
      status: number,
      ms: number,
      requestPreview: string,
      responsePreview: string,
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: LogEntry = {
        id,
        at: new Date().toISOString(),
        method,
        path,
        status,
        ms,
        requestPreview,
        responsePreview,
        tab: 'response',
      };
      setLog((prev) => [entry, ...prev].slice(0, 50));
      setActiveId(id);
    },
    [],
  );

  const run = useCallback(
    async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const t0 = performance.now();
      try {
        let status = 0;
        let text = '';
        if (method === 'GET') {
          const res = await apiClient.get(path);
          status = res.status;
          text = JSON.stringify(res.data, null, 2);
        } else {
          const res = await apiClient.post(path, body ?? {});
          status = res.status;
          text = JSON.stringify(res.data, null, 2);
        }
        pushLog(
          method,
          path,
          status,
          Math.round(performance.now() - t0),
          body ? JSON.stringify(body, null, 2) : '',
          text,
        );
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: unknown } };
        const status = err.response?.status ?? 0;
        const text = JSON.stringify(err.response?.data ?? { error: String(e) }, null, 2);
        pushLog(method, path, status, Math.round(performance.now() - t0), JSON.stringify(body ?? {}), text);
      }
    },
    [pushLog],
  );

  const runWebhook = useCallback(async () => {
    if (!selected?.zodomusPropertyId) {
      alert(t('alertSelectProperty'));
      return;
    }
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const t0 = performance.now();
    const body = {
      webhookKey: webhookKey || undefined,
      channelId: Number(channelId),
      propertyId: selected.zodomusPropertyId,
      reservationId: webhookReservationId,
      reservationStatus: Number(webhookStatus),
    };
    try {
      const res = await fetch(`${base}/api/v1/integrations/zodomus/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      pushLog(
        'POST',
        '/integrations/zodomus/webhook',
        res.status,
        Math.round(performance.now() - t0),
        JSON.stringify(body, null, 2),
        JSON.stringify(data, null, 2),
      );
    } catch (e) {
      pushLog('POST', '/integrations/zodomus/webhook', 0, Math.round(performance.now() - t0), JSON.stringify(body), String(e));
    }
  }, [selected, channelId, webhookKey, webhookReservationId, webhookStatus, pushLog, t]);

  const copyCli = useCallback(() => {
    const cmd = 'pnpm zodomus:fetch-samples';
    void navigator.clipboard.writeText(cmd);
  }, []);

  const active = log.find((l) => l.id === activeId) ?? log[0];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <h1 className="text-lg font-semibold text-white">{t('title')}</h1>
          <p className="mt-1 text-xs text-zinc-500">{t('subtitle')}</p>
          <SectionHelp text={t('headerIntro')} />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-400">{t('labelProperty')}</span>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option value="">{t('selectPlaceholder')}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.zodomusPropertyId ? `· OTA ${p.zodomusPropertyId}` : ''}
                  </option>
                ))}
              </select>
              <span className="text-[11px] leading-snug text-zinc-600">{t('hintProperty')}</span>
              {propsLoading && <span className="text-zinc-500">{t('loadingProps')}</span>}
              {propsError && <span className="text-red-400">{t('propsError')}</span>}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-400">{t('labelChannel')}</span>
              <input
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <span className="text-[11px] leading-snug text-zinc-600">{t('hintChannel')}</span>
            </label>
            <label className="flex flex-col gap-1 text-xs md:pt-0">
              <span className="text-zinc-400">{t('labelForce')}</span>
              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              </div>
              <span className="text-[11px] leading-snug text-zinc-600">{t('hintForce')}</span>
            </label>
          </div>
        </header>

        <section className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <h2 className="text-sm font-medium text-emerald-300/90">{t('zoneATitle')}</h2>
          <SectionHelp text={t('zoneAHelp')} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => void run('GET', '/integrations/zodomus/status')}>GET status</Btn>
            <Btn
              disabled={!propertyId}
              onClick={() =>
                void run('POST', '/integrations/zodomus/sync', {
                  channelId: Number(channelId),
                  propertyId,
                  force,
                })
              }
            >
              POST sync
            </Btn>
            <Btn
              onClick={() =>
                void run('POST', '/integrations/zodomus/sync-all', {
                  channelId: Number(channelId),
                  force,
                })
              }
            >
              POST sync-all
            </Btn>
            <Btn
              disabled={!propertyId}
              onClick={() =>
                void run('POST', '/integrations/zodomus/import-summary', {
                  channelId: Number(channelId),
                  propertyId,
                })
              }
            >
              POST import-summary
            </Btn>
            <Btn
              disabled={!propertyId}
              onClick={() =>
                void run('POST', '/integrations/zodomus/push-availability', { propertyId })
              }
            >
              POST push-availability
            </Btn>
          </div>
        </section>

        <section className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4">
          <h2 className="text-sm font-medium text-indigo-300/90">{t('zoneActivationTitle')}</h2>
          <SectionHelp text={t('zoneActivationHelp')} />
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Btn onClick={() => void run('GET', '/admin/zodomus/price-model')}>
                {t('btnPriceModel')}
              </Btn>
            </div>
            <div className="flex max-w-md flex-col gap-1">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-400">{t('labelPriceModelId')}</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={priceModelId}
                  onChange={(e) => setPriceModelId(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm"
                />
              </label>
              <span className="text-[11px] leading-snug text-amber-500/90">{t('hintPriceModelId')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn
                disabled={!canUseZodomusProperty || !priceModelOk}
                onClick={() =>
                  void run('POST', '/admin/zodomus/property-activation', {
                    propertyId,
                    channelId: Number(channelId),
                    priceModelId: priceModelIdNum,
                  })
                }
              >
                {t('btnPropertyActivation')}
              </Btn>
              <Btn
                disabled={!canUseZodomusProperty}
                onClick={() =>
                  void run('POST', '/admin/zodomus/property-check', {
                    propertyId,
                    channelId: Number(channelId),
                  })
                }
              >
                {t('btnPropertyCheck')}
              </Btn>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-4">
          <h2 className="text-sm font-medium text-sky-300/90">{t('zoneBTitle')}</h2>
          <SectionHelp text={t('zoneBHelp')} />
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Btn
                disabled={!propertyId}
                onClick={() =>
                  void run(
                    'GET',
                    `/admin/zodomus/room-rates?channelId=${encodeURIComponent(channelId)}&propertyId=${encodeURIComponent(propertyId)}`,
                  )
                }
              >
                GET room-rates
              </Btn>
              <Btn
                disabled={!propertyId}
                onClick={() =>
                  void run(
                    'GET',
                    `/admin/zodomus/reservations-queue?channelId=${encodeURIComponent(channelId)}&propertyId=${encodeURIComponent(propertyId)}`,
                  )
                }
              >
                GET reservations-queue
              </Btn>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-400">{t('labelDateFrom')}</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-400">{t('labelDateTo')}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <Btn
                disabled={!propertyId || !dateFrom || !dateTo}
                onClick={() =>
                  void run(
                    'GET',
                    `/admin/zodomus/availability?channelId=${encodeURIComponent(channelId)}&propertyId=${encodeURIComponent(propertyId)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
                  )
                }
              >
                GET availability
              </Btn>
            </div>
            <div>
              <SectionHelp text={t('zoneBCreatetestHelp')} />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="flex min-w-[160px] flex-col gap-1 text-xs">
                  <span className="text-zinc-400">{t('labelCreateTestStatus')}</span>
                  <select
                    value={createTestStatus}
                    onChange={(e) =>
                      setCreateTestStatus(e.target.value as typeof createTestStatus)
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option value="new">new</option>
                    <option value="modified">modified</option>
                    <option value="cancelled">cancelled</option>
                    <option value="summary">summary</option>
                  </select>
                </label>
                <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs">
                  <span className="text-zinc-400">{t('labelCreateTestReservationId')}</span>
                  <input
                    value={createTestReservationIdOpt}
                    onChange={(e) => setCreateTestReservationIdOpt(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm"
                    placeholder={t('placeholderOptional')}
                  />
                </label>
                <Btn
                  disabled={!propertyId}
                  onClick={() =>
                    void run('POST', '/admin/zodomus/create-test-reservation', {
                      propertyId,
                      channelId: Number(channelId),
                      status: createTestStatus,
                      ...(createTestReservationIdOpt.trim()
                        ? { reservationId: createTestReservationIdOpt.trim() }
                        : {}),
                    })
                  }
                >
                  {t('btnCreateTestReservation')}
                </Btn>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
          <h2 className="text-sm font-medium text-amber-300/90">{t('webhookTitle')}</h2>
          <SectionHelp text={t('webhookHelp')} />
          <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">{t('webhookKeyHint')}</span>
              <input
                value={webhookKey}
                onChange={(e) => setWebhookKey(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
                placeholder={t('placeholderOptional')}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">{t('webhookReservationHint')}</span>
              <input
                value={webhookReservationId}
                onChange={(e) => setWebhookReservationId(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-zinc-500">{t('webhookStatusHint')}</span>
              <input
                value={webhookStatus}
                onChange={(e) => setWebhookStatus(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
          <div className="mt-3">
            <Btn onClick={() => void runWebhook()}>POST webhook</Btn>
            {selected && !selected.zodomusPropertyId && (
              <span className="ml-2 text-xs text-amber-400">{t('webhookNeedProperty')}</span>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-medium text-zinc-300">{t('zoneCTitle')}</h2>
          <SectionHelp text={t('zoneCHelp')} />
          <button
            type="button"
            onClick={copyCli}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('copyCli')}
          </button>
        </section>
      </div>

      <aside className="flex w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-900/50">
        <div className="border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">{t('logTitle')}</span>
            <button
              type="button"
              onClick={() => setLog([])}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <Trash2 className="h-3 w-3" /> {t('logClear')}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-600">{t('logHelp')}</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-40 overflow-auto border-b border-zinc-800">
            {log.length === 0 && <p className="p-3 text-xs text-zinc-600">{t('logEmpty')}</p>}
            {log.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setActiveId(entry.id);
                }}
                className={`flex w-full items-center gap-2 border-b border-zinc-800/80 px-3 py-2 text-left text-xs hover:bg-zinc-800/50 ${
                  activeId === entry.id ? 'bg-zinc-800/40' : ''
                }`}
              >
                <span
                  className={
                    entry.status >= 200 && entry.status < 300 ? 'text-emerald-400' : 'text-red-400'
                  }
                >
                  {entry.status}
                </span>
                <span className="font-mono text-zinc-400">{entry.method}</span>
                <span className="truncate text-zinc-300">{entry.path}</span>
                <span className="ml-auto shrink-0 text-zinc-600">{entry.ms}ms</span>
              </button>
            ))}
          </div>
          {active && (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
                {(
                  [
                    ['response', t('logTabResponse')] as const,
                    ['request', t('logTabRequest')] as const,
                    ['headers', t('logTabHeaders')] as const,
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() =>
                      setLog((prev) =>
                        prev.map((x) => (x.id === active.id ? { ...x, tab } : x)),
                      )
                    }
                    className={`rounded px-2 py-1 text-xs ${
                      active.tab === tab ? 'bg-zinc-800 text-white' : 'text-zinc-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <pre className="mt-2 max-h-[calc(100vh-12rem)] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-emerald-100/90">
                {active.tab === 'response' && active.responsePreview}
                {active.tab === 'request' && (active.requestPreview || '—')}
                {active.tab === 'headers' && t('logHeadersHint')}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Play className="h-3 w-3" />
      {children}
    </button>
  );
}
