import { apiClient } from '@/lib/api/client';

/** Mirrors backend `src/integrations/zodomus/airbnb` and `src/airbnb` (`/api/v1/zodomus/airbnb`). */

export interface AirbnbHostView {
  /** ZODOMUS_AIRBNB_ENABLED on the server — the page and the menu item exist only then. */
  enabled: boolean;
  pilotListingIds: string[];
  /** null — the host was never connected. */
  host: {
    statusCode: number | null;
    statusText: string | null;
    active: boolean;
    checkedAt: string | null;
    /** The airbnb.com page where the host allows access — while not active. */
    authUrl: string | null;
  } | null;
}

export interface AirbnbListingsView {
  pilot: { id: string; name: string | null } | null;
  others: number;
  truncated: boolean;
}

export interface AirbnbCalendarOperation {
  dates: string[];
  availability: 'available' | 'unavailable';
  dailyPrice?: number;
}

export interface AirbnbPlanSummary {
  listingId: string;
  from: string;
  toExclusive: string;
  nights: number;
  forSale: number;
  occupied: number;
  noPrice: number;
  operations: number;
  requests: number;
  sample: AirbnbCalendarOperation[];
  minPrice: number | null;
  maxPrice: number | null;
  fingerprint: string;
}

export interface AirbnbJob {
  propertyId: string;
  kind: 'check' | 'connect' | 'send';
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  plan: AirbnbPlanSummary | null;
  result: { activated: boolean; sentCalls: number; failedCalls: number; closedAll: boolean; errors: string[] } | null;
}

export interface AirbnbListingView {
  listingId: string;
  connected: boolean;
  activatedAt: string | null;
  planEnd: string | null;
  lastSyncAt: string | null;
  lastSync: {
    kind?: 'full' | 'availability';
    operations?: number;
    sentCalls?: number;
    failedCalls?: number;
    closedAll?: boolean;
    errors?: string[];
  } | null;
  takenByOther: boolean;
  job: AirbnbJob | null;
  /** The check «Подключить» / «Отправить» accept now — by the server's clock (15 minutes), or null. */
  freshPlan: (AirbnbPlanSummary & { checkedAt: string; expiresAt: string }) | null;
}

type Envelope<T> = { data: { data: T } };
const unwrap = <T>(p: Promise<Envelope<T>>): Promise<T> => p.then((r) => r.data.data);

export const airbnbApi = {
  status: () => unwrap<AirbnbHostView>(apiClient.get('/zodomus/airbnb/status')),
  activateHost: () => unwrap<AirbnbHostView>(apiClient.post('/zodomus/airbnb/host/activate')),
  refreshHost: () => unwrap<AirbnbHostView>(apiClient.post('/zodomus/airbnb/host/refresh')),
  listings: () => unwrap<AirbnbListingsView>(apiClient.get('/zodomus/airbnb/listings')),
  /** The property the pilot listing is connected to. */
  connectedProperty: () => unwrap<{ propertyId: string | null }>(apiClient.get('/zodomus/airbnb/listing')),
  listing: (propertyId: string) => unwrap<AirbnbListingView>(apiClient.get(`/zodomus/airbnb/listing/${propertyId}`)),
  check: (propertyId: string) => unwrap<AirbnbJob>(apiClient.post(`/zodomus/airbnb/listing/${propertyId}/check`)),
  connect: (propertyId: string, fingerprint: string) =>
    unwrap<AirbnbJob>(apiClient.post(`/zodomus/airbnb/listing/${propertyId}/connect`, { fingerprint })),
  send: (propertyId: string, fingerprint: string) =>
    unwrap<AirbnbJob>(apiClient.post(`/zodomus/airbnb/listing/${propertyId}/send`, { fingerprint })),
};
