'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import { fetcher } from '@/lib/api/fetcher';
import { useProperties } from '@/hooks/use-properties';

type ApiRefRoomIdPlacement = 'query' | 'body' | 'bodyRoomIds' | 'bodyRooms';

type ApiRefEntry = {
  path: string;
  method: 'GET' | 'POST';
  group: string;
  description: string;
  scope: 'account' | 'property' | 'none';
  requiresRentaiProperty: boolean;
  requiresRoomId?: boolean;
  roomIdPlacement?: ApiRefRoomIdPlacement;
};

type CatalogResponse = {
  excluded: string[];
  excludedReason: string;
  entries: ApiRefEntry[];
};

type RentaiCard = {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  needsProperty: boolean;
  buildBody?: () => unknown;
  buildPath?: () => string;
};

type LogEntry = {
  id: string;
  at: string;
  label: string;
  status: number;
  ms: number;
  request: string;
  response: string;
};

function pretty(value: unknown): string {
  if (value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function propertyHasZodomus(p: {
  zodomusPropertyId?: string | null;
  channelListings?: Array<{ externalListingId?: string | null }> | null;
}): boolean {
  return (
    Boolean(p.zodomusPropertyId?.trim()) ||
    Boolean(p.channelListings?.some((c) => c.externalListingId?.trim()))
  );
}

function resolvePropertyRoomId(
  p:
    | {
        zodomusRoomId?: string | null;
        otaPlatform?: { zodomusChannelId?: number } | null;
        channelListings?: Array<{
          zodomusRoomId?: string | null;
          otaPlatform?: { zodomusChannelId?: number } | null;
        }> | null;
      }
    | undefined,
  channelId: number,
): string {
  if (!p) return '';
  const listings = p.channelListings ?? [];
  for (const row of listings) {
    if (row.otaPlatform?.zodomusChannelId === channelId) {
      const room = row.zodomusRoomId?.trim();
      if (room) return room;
    }
  }
  if (listings.length === 0 || p.otaPlatform?.zodomusChannelId === channelId) {
    return p.zodomusRoomId?.trim() || '';
  }
  return '';
}

export function ZodomusApiExplorer() {
  const t = useTranslations('zodomusApiRef');
  const { properties, isLoading: propsLoading } = useProperties();

  const [propertyId, setPropertyId] = useState('');
  const [channelId, setChannelId] = useState('1');
  const [roomId, setRoomId] = useState('');
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({ rentai: true, account: true });
  const [force, setForce] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [reservationId, setReservationId] = useState('');
  const [createTestStatus, setCreateTestStatus] = useState('new');
  const [priceModelId, setPriceModelId] = useState('2');
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [queryDrafts, setQueryDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const selected = useMemo(
    () => properties.find((p) => p.id === propertyId),
    [properties, propertyId],
  );

  const hasZodomus = selected ? propertyHasZodomus(selected) : false;

  useEffect(() => {
    if (!propertyId && properties.length > 0) {
      const linked = properties.find((p) => propertyHasZodomus(p));
      const fallback = properties[0];
      if (!fallback) return;
      setPropertyId((linked ?? fallback).id);
    }
  }, [properties, propertyId]);

  useEffect(() => {
    const ch = selected?.otaPlatform?.zodomusChannelId;
    if (ch != null) setChannelId(String(ch));
  }, [selected?.id, selected?.otaPlatform?.zodomusChannelId]);

  const ch = Number(channelId) || 1;
  const propertyRoomId = useMemo(
    () => resolvePropertyRoomId(selected, ch),
    [selected, ch],
  );

  useEffect(() => {
    if (propertyRoomId) setRoomId(propertyRoomId);
  }, [selected?.id, ch, propertyRoomId]);

  const { data: catalog, error: catalogError, isLoading: catalogLoading } = useSWR<CatalogResponse>(
    '/integrations/zodomus/api-ref/catalog',
    fetcher,
  );

  const roomIdTrim = roomId.trim();

  const rentaiCards = useMemo((): RentaiCard[] => {
    return [
      {
        id: 'status',
        method: 'GET',
        path: '/integrations/zodomus/status',
        needsProperty: false,
      },
      {
        id: 'sync',
        method: 'POST',
        path: '/integrations/zodomus/sync',
        needsProperty: true,
        buildBody: () => ({ channelId: ch, propertyId, force }),
      },
      {
        id: 'import-summary',
        method: 'POST',
        path: '/integrations/zodomus/import-summary',
        needsProperty: true,
        buildBody: () => ({ channelId: ch, propertyId }),
      },
      {
        id: 'push-availability',
        method: 'POST',
        path: '/integrations/zodomus/push-availability',
        needsProperty: true,
        buildBody: () => ({ propertyId }),
      },
      {
        id: 'availability-push-targets',
        method: 'GET',
        path: '/integrations/zodomus/availability-push-targets',
        needsProperty: true,
        buildPath: () =>
          `/integrations/zodomus/availability-push-targets?propertyId=${encodeURIComponent(propertyId)}`,
      },
      {
        id: 'sync-all',
        method: 'POST',
        path: '/integrations/zodomus/sync-all',
        needsProperty: false,
        buildBody: () => ({ channelId: ch, force }),
      },
    ];
  }, [ch, propertyId, force]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiRefEntry[]>();
    for (const e of catalog?.entries ?? []) {
      const list = map.get(e.group) ?? [];
      list.push(e);
      map.set(e.group, list);
    }
    return map;
  }, [catalog?.entries]);

  const pushLog = useCallback(
    (label: string, status: number, ms: number, request: string, response: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setLog((prev) =>
        [{ id, at: new Date().toISOString(), label, status, ms, request, response }, ...prev].slice(0, 30),
      );
    },
    [],
  );

  const runRentai = useCallback(
    async (card: RentaiCard) => {
      if (card.needsProperty && !propertyId) {
        toast.error(t('needProperty'));
        return;
      }
      const key = `rentai:${card.id}`;
      setBusyKey(key);
      const t0 = performance.now();
      const path = card.buildPath?.() ?? card.path;
      const body = card.buildBody?.();
      try {
        const res =
          card.method === 'GET' ? await apiClient.get(path) : await apiClient.post(path, body ?? {});
        pushLog(
          `${card.method} ${path}`,
          res.status,
          Math.round(performance.now() - t0),
          body ? pretty(body) : '—',
          pretty(res.data),
        );
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: unknown } };
        pushLog(
          `${card.method} ${path}`,
          err.response?.status ?? 0,
          Math.round(performance.now() - t0),
          body ? pretty(body) : '—',
          pretty(err.response?.data ?? { error: String(e) }),
        );
        toast.error(t('runError'));
      } finally {
        setBusyKey(null);
      }
    },
    [propertyId, pushLog, t],
  );

  const defaultQueryFor = useCallback(
    (entry: ApiRefEntry): Record<string, string> => {
      if (entry.path === '/availability' && entry.method === 'GET') {
        return { dateFrom, dateTo };
      }
      if (entry.path === '/reservations' && entry.method === 'GET') {
        return reservationId.trim() ? { reservationId: reservationId.trim() } : {};
      }
      if (entry.requiresRoomId && (entry.roomIdPlacement ?? 'body') === 'query') {
        return roomIdTrim ? { roomId: roomIdTrim } : {};
      }
      return {};
    },
    [dateFrom, dateTo, reservationId, roomIdTrim],
  );

  const defaultBodyFor = useCallback(
    (entry: ApiRefEntry): unknown => {
      if (entry.path === '/property-activation') {
        return { priceModelId: Number(priceModelId) || 2 };
      }
      if (entry.path === '/reservations-createtest') {
        return {
          status: createTestStatus,
          ...(reservationId.trim() ? { reservationId: reservationId.trim() } : {}),
        };
      }
      if (entry.path === '/rooms-activation' || entry.path === '/rooms-cancellation') {
        return {
          rooms: [
            {
              roomId: roomIdTrim,
              roomName: 'Room',
              quantity: 1,
              status: 1,
              rates: [],
            },
          ],
        };
      }
      if (entry.path === '/availability' && entry.method === 'POST') {
        return { roomId: roomIdTrim, dateFrom, dateTo, availability: 0 };
      }
      if (entry.path === '/availability-multiple') {
        return { roomIds: [{ roomId: roomIdTrim, dateFrom, dateTo, availability: 0 }] };
      }
      if (entry.path === '/rates' || entry.path === '/rates-derived') {
        return { roomId: roomIdTrim, rateId: '', dateFrom, dateTo, price: 0 };
      }
      if (entry.path === '/room' && entry.method === 'POST') {
        return { roomId: roomIdTrim };
      }
      if (entry.path === '/room-status') {
        return { roomId: roomIdTrim, status: 1 };
      }
      if (entry.path === '/rate' && entry.method === 'POST') {
        return { roomId: roomIdTrim, rateId: '' };
      }
      if (entry.path === '/product') {
        return { roomId: roomIdTrim, rateId: '' };
      }
      if (entry.requiresRoomId && (entry.roomIdPlacement ?? 'body') === 'body') {
        return { roomId: roomIdTrim };
      }
      return {};
    },
    [priceModelId, createTestStatus, reservationId, dateFrom, dateTo, roomIdTrim],
  );

  const entryKey = (entry: ApiRefEntry) => `${entry.method}:${entry.path}`;

  const runUpstream = useCallback(
    async (entry: ApiRefEntry) => {
      if (entry.requiresRentaiProperty && (!propertyId || !hasZodomus)) {
        toast.error(t('needZodomus'));
        return;
      }
      const key = entryKey(entry);
      setBusyKey(key);
      const t0 = performance.now();

      let query = defaultQueryFor(entry);
      let body: unknown = entry.method === 'POST' ? defaultBodyFor(entry) : undefined;

      const qDraft = queryDrafts[key]?.trim();
      if (qDraft) {
        try {
          query = JSON.parse(qDraft) as Record<string, string>;
        } catch {
          toast.error(t('invalidJsonQuery'));
          setBusyKey(null);
          return;
        }
      }
      const bDraft = bodyDrafts[key]?.trim();
      if (entry.method === 'POST' && bDraft) {
        try {
          body = JSON.parse(bDraft) as unknown;
        } catch {
          toast.error(t('invalidJsonBody'));
          setBusyKey(null);
          return;
        }
      }

      const payload = {
        method: entry.method,
        path: entry.path,
        propertyId: entry.requiresRentaiProperty ? propertyId : undefined,
        channelId: entry.requiresRentaiProperty || entry.scope === 'property' ? ch : undefined,
        roomId: entry.requiresRoomId && roomIdTrim ? roomIdTrim : undefined,
        query: entry.method === 'GET' ? query : undefined,
        body: entry.method === 'POST' ? body : undefined,
      };

      try {
        const res = await apiClient.post('/integrations/zodomus/api-ref/invoke', payload);
        pushLog(
          `${entry.method} ${entry.path}`,
          res.status,
          Math.round(performance.now() - t0),
          pretty(payload),
          pretty(res.data),
        );
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: unknown } };
        pushLog(
          `${entry.method} ${entry.path}`,
          err.response?.status ?? 0,
          Math.round(performance.now() - t0),
          pretty(payload),
          pretty(err.response?.data ?? { error: String(e) }),
        );
        toast.error(t('runError'));
      } finally {
        setBusyKey(null);
      }
    },
    [
      propertyId,
      hasZodomus,
      ch,
      roomIdTrim,
      defaultQueryFor,
      defaultBodyFor,
      queryDrafts,
      bodyDrafts,
      pushLog,
      t,
    ],
  );

  const groupLabel = (group: string): string => {
    const key = `groups.${group}` as
      | 'groups.rentai'
      | 'groups.account'
      | 'groups.mapping'
      | 'groups.airbnb'
      | 'groups.rates'
      | 'groups.reservations'
      | 'groups.content'
      | 'groups.booking-tables'
      | 'groups.expedia-tables'
      | 'groups.opportunities'
      | 'groups.reviews'
      | 'groups.reporting'
      | 'groups.promotions';
    return t(key);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </header>

      {catalog?.excludedReason ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('excludedNote', {
            paths: (catalog.excluded ?? []).join(', '),
            reason: catalog.excludedReason,
          })}
        </p>
      ) : null}

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium">{t('contextTitle')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1 space-y-1">
            <Label htmlFor="api-ref-property" className="text-[10px] text-muted-foreground">
              {t('property')}
            </Label>
            <select
              id="api-ref-property"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={propertyId}
              disabled={propsLoading}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">{t('propertyPlaceholder')}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {propertyHasZodomus(p) ? '' : ` (${t('noZodomus')})`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-ch" className="text-[10px] text-muted-foreground">
              {t('channelId')}
            </Label>
            <Input
              id="api-ref-ch"
              type="number"
              min={1}
              className="h-9 w-20 tabular-nums"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-room" className="text-[10px] text-muted-foreground">
              {t('roomId')}
            </Label>
            <Input
              id="api-ref-room"
              className="h-9 w-40 font-mono text-xs"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder={t('roomIdPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-from" className="text-[10px] text-muted-foreground">
              {t('dateFrom')}
            </Label>
            <Input
              id="api-ref-from"
              type="date"
              className="h-9 w-[9.5rem]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-to" className="text-[10px] text-muted-foreground">
              {t('dateTo')}
            </Label>
            <Input
              id="api-ref-to"
              type="date"
              className="h-9 w-[9.5rem]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-rid" className="text-[10px] text-muted-foreground">
              {t('reservationId')}
            </Label>
            <Input
              id="api-ref-rid"
              className="h-9 w-36 font-mono text-xs"
              value={reservationId}
              onChange={(e) => setReservationId(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-pm" className="text-[10px] text-muted-foreground">
              {t('priceModelId')}
            </Label>
            <Input
              id="api-ref-pm"
              type="number"
              min={1}
              max={5}
              className="h-9 w-16 tabular-nums"
              value={priceModelId}
              onChange={(e) => setPriceModelId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-ref-ct" className="text-[10px] text-muted-foreground">
              {t('createTestStatus')}
            </Label>
            <Input
              id="api-ref-ct"
              className="h-9 w-28 font-mono text-xs"
              value={createTestStatus}
              onChange={(e) => setCreateTestStatus(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t('force')}
          </label>
        </div>
        {selected && !hasZodomus ? (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">{t('needZodomus')}</p>
        ) : null}
      </div>

      <section className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
        <button
          type="button"
          className="mb-3 flex w-full items-center gap-1 text-left text-sm font-semibold"
          onClick={() => setGroupOpen((s) => ({ ...s, rentai: !s.rentai }))}
        >
          {groupOpen.rentai ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {t('groups.rentai')}
        </button>
        {groupOpen.rentai ? (
          <div className="grid gap-2">
            {rentaiCards.map((card) => {
              const key = `rentai:${card.id}`;
              const disabled =
                (card.needsProperty && (!propertyId || !hasZodomus)) || busyKey === key;
              return (
                <div key={card.id} className="rounded-lg border bg-background/80 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-mono text-xs">
                      <span className="text-violet-600 dark:text-violet-300">{card.method}</span>{' '}
                      {card.buildPath?.() ?? card.path}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      disabled={disabled}
                      onClick={() => void runRentai(card)}
                    >
                      {busyKey === key ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1 h-3.5 w-3.5" />
                      )}
                      {t('run')}
                    </Button>
                  </div>
                  {card.buildBody ? (
                    <pre className="mt-2 max-h-24 overflow-auto rounded border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {pretty(card.buildBody())}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {catalogLoading ? <p className="text-sm text-muted-foreground">{t('loadingCatalog')}</p> : null}
      {catalogError ? <p className="text-sm text-destructive">{t('catalogError')}</p> : null}

      {[...grouped.entries()].map(([group, entries]) => (
        <section key={group} className="rounded-xl border p-4">
          <button
            type="button"
            className="mb-3 flex w-full items-center gap-1 text-left text-sm font-semibold"
            onClick={() => setGroupOpen((s) => ({ ...s, [group]: !s[group] }))}
          >
            {groupOpen[group] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {groupLabel(group)}
            <span className="ml-1 font-normal text-muted-foreground">({entries.length})</span>
          </button>
          {groupOpen[group] ? (
            <div className="grid gap-2">
              {entries.map((entry) => {
                const key = entryKey(entry);
                const disabled =
                  (entry.requiresRentaiProperty && (!propertyId || !hasZodomus)) || busyKey === key;
                const defaultQ = defaultQueryFor(entry);
                const defaultB = defaultBodyFor(entry);
                return (
                  <div key={key} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs">
                          <span className="text-violet-600 dark:text-violet-300">{entry.method}</span>{' '}
                          {entry.path}
                          {entry.requiresRoomId ? (
                            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-sans font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
                              {t('requiresRoomIdBadge')}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.description}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8"
                        disabled={disabled}
                        onClick={() => void runUpstream(entry)}
                      >
                        {busyKey === key ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="mr-1 h-3.5 w-3.5" />
                        )}
                        {t('run')}
                      </Button>
                    </div>
                    {entry.method === 'GET' &&
                    (Object.keys(defaultQ).length > 0 ||
                      (entry.requiresRoomId && (entry.roomIdPlacement ?? 'body') === 'query')) ? (
                      <div className="mt-2 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">{t('queryJson')}</Label>
                        <Textarea
                          className="min-h-[52px] font-mono text-[10px]"
                          value={queryDrafts[key] ?? pretty(defaultQ)}
                          onChange={(e) => setQueryDrafts((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      </div>
                    ) : null}
                    {entry.method === 'POST' ? (
                      <div className="mt-2 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">{t('bodyJson')}</Label>
                        <Textarea
                          className="min-h-[72px] font-mono text-[10px]"
                          value={bodyDrafts[key] ?? pretty(defaultB)}
                          onChange={(e) => setBodyDrafts((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}

      {log.length > 0 ? (
        <div className="space-y-2 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{t('logTitle')}</p>
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setLog([])}>
              {t('clearLog')}
            </Button>
          </div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {log.map((entry) => (
              <div key={entry.id} className="rounded-md border bg-muted/30 p-2">
                <p className="font-mono text-[10px]">
                  <span
                    className={
                      entry.status >= 200 && entry.status < 300 ? 'text-emerald-600' : 'text-destructive'
                    }
                  >
                    {entry.status || 'ERR'}
                  </span>{' '}
                  {entry.label} · {entry.ms}ms
                </p>
                <pre className="mt-1 max-h-48 overflow-auto font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {entry.response}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
