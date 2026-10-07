import { apiClient } from '@/lib/api/client';

/** Mirrors backend `backend/src/pricing` DTOs (`/api/v1/pricing`). */

export type BookingWeekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type PromotionTargetState = 'pending' | 'on' | 'off' | 'error' | 'skipped' | 'dry_run';
export type PromotionSource = 'rentai' | 'booking';
export type PromotionsAccess = 'ok' | 'denied' | 'unknown';

export interface PricingStatus {
  enabled: boolean;
  dryRun: boolean;
  pilot: boolean;
  channelId: number;
  /** «Автоправила» switched on (ZODOMUS_PROMOTIONS_AUTORULES_ENABLED). */
  autoRules?: boolean;
}

export interface PromotionStatsSummary {
  bookings: number;
  nights: number;
  cancellations: number;
  revenueByCurrency: Record<string, number>;
}

export interface PromotionTargetBrief {
  propertyId: string;
  desiredState: 'on' | 'off';
  state: PromotionTargetState;
  lastErrorCode: string | null;
  stats: PromotionTargetStats | null;
}

export interface PromotionTargetStats {
  bookings: number | null;
  nights: number | null;
  revenue: number | null;
  currency: string | null;
  cancellations: number | null;
  at: string;
}

export interface PromotionSummary {
  id: string;
  name: string;
  source: PromotionSource;
  promotionType: string;
  discountPct: number;
  stayFrom: string | null;
  stayTo: string | null;
  activeWeekdays: BookingWeekday[] | null;
  protectMinPrice: boolean;
  status: 'active' | 'off';
  derivedStatus: 'active' | 'finished' | 'off';
  externalMeta: Record<string, unknown> | null;
  createdAt: string;
  counts: Record<PromotionTargetState, number> & { total: number };
  stats: PromotionStatsSummary | null;
  /** Present when listed for one property (`?propertyId=`). */
  target?: PromotionTargetBrief;
}

export interface PromotionTarget {
  propertyId: string;
  propertyName: string;
  desiredState: 'on' | 'off';
  state: PromotionTargetState;
  externalPromotionId: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  verifiedAt: string | null;
  verifyNote: string | null;
  stats: PromotionTargetStats | null;
  lastSyncedAt: string | null;
}

export interface PromotionEvent {
  id: string;
  createdAt: string;
  actorLabel: string;
  action: string;
  message: string;
  propertyId: string | null;
  details: Record<string, unknown> | null;
}

export interface PromotionDetail extends PromotionSummary {
  targets: PromotionTarget[];
  events: PromotionEvent[];
}

export interface PricingPropertyRow {
  id: string;
  name: string;
  timezone: string;
  bookingConnected: boolean;
  externalPropertyId: string | null;
  minPrice: number | null;
  geniusPct: number | null;
  promotionsAccess: PromotionsAccess | null;
  promotionsAccessCode: string | null;
  /** What Zodomus answered on the last failed check. */
  promotionsAccessDetail: string | null;
  promotionsAccessCheckedAt: string | null;
}

export interface PriceToday {
  propertyId: string;
  date: string;
  price: number | null;
  geniusPct: number | null;
  geniusPrice: number | null;
  currency: string;
}

export interface PromotionInput {
  name?: string;
  discountPct: number;
  /** Inclusive yyyy-MM-dd. */
  stayFrom: string;
  /** Inclusive yyyy-MM-dd. */
  stayTo: string;
  weekdays?: BookingWeekday[] | null;
  propertyIds?: string[];
  protectMinPrice?: boolean;
}

export interface OverlapInfo {
  promotionId: string;
  name: string;
  discountPct: number;
  source: PromotionSource;
  from: string;
  to: string;
  propertyIds: string[];
  visible: 'new' | 'existing' | 'equal';
}

export interface PromotionPreview {
  eligible: { propertyId: string; name: string }[];
  excluded: { propertyId: string; name: string; reason: 'NO_BOOKING' | 'NO_ACCESS' }[];
  overlaps: OverlapInfo[];
}

export interface CalendarPromotion {
  id: string;
  name: string;
  source: PromotionSource;
  promotionType: string;
  discountPct: number;
  from: string;
  to: string;
  activeWeekdays: BookingWeekday[] | null;
  properties: { propertyId: string; state: PromotionTargetState }[];
}

export type SettingsItem = { propertyId: string; minPrice?: number | null; geniusPct?: number | null };

// ─── «Автоправила» ───────────────────────────────────────────────────────────

export type RuleUnit = 'day' | 'hour';
/** Hours of the day in the property time zone: start inclusive, end exclusive (0–24). */
export type BookTime = { start: number; end: number };

export interface RuleStepInput {
  discountPct: number;
  unit: RuleUnit;
  /** Guest books at most this many days / hours before check-in. */
  value: number;
  /** null = any time of the day. */
  bookTime: BookTime | null;
}

export interface RuleInput {
  name: string;
  steps: RuleStepInput[];
  weekdays?: BookingWeekday[] | null;
  horizonMonths: number;
  propertyIds?: string[];
  protectMinPrice?: boolean;
  /** Editing: create this rule, then switch the old one off. */
  replaceGroupId?: string;
}

export interface RuleStepView extends RuleStepInput {
  id: string;
  name: string;
  status: 'active' | 'off';
  derivedStatus: 'active' | 'finished' | 'off';
  counts: Record<PromotionTargetState, number> & { total: number };
}

export interface RuleView {
  groupId: string;
  name: string;
  createdAt: string;
  weekdays: BookingWeekday[] | null;
  protectMinPrice: boolean;
  horizonMonths: number;
  stayFrom: string | null;
  stayTo: string | null;
  status: 'active' | 'off' | 'finished';
  counts: Record<PromotionTargetState, number> & { total: number };
  steps: RuleStepView[];
  properties: { propertyId: string; propertyName: string; state: PromotionTargetState }[];
}

type Envelope<T> = { data: { data: T } };
const unwrap = <T>(p: Promise<Envelope<T>>): Promise<T> => p.then((r) => r.data.data);

export const pricingApi = {
  status: () => unwrap<PricingStatus>(apiClient.get('/pricing/status')),
  properties: () => unwrap<PricingPropertyRow[]>(apiClient.get('/pricing/properties')),
  updateSettings: (items: SettingsItem[]) =>
    unwrap<PricingPropertyRow[]>(apiClient.patch('/pricing/properties/settings', { items })),
  accessCheck: (propertyIds?: string[]) =>
    unwrap<{ started: number }>(
      apiClient.post('/pricing/properties/access-check', propertyIds ? { propertyIds } : {}),
    ),
  priceToday: (propertyId: string) =>
    unwrap<PriceToday>(apiClient.get(`/pricing/properties/${propertyId}/price-today`)),
  list: (propertyId?: string) =>
    unwrap<PromotionSummary[]>(
      apiClient.get('/pricing/promotions', { params: propertyId ? { propertyId } : undefined }),
    ),
  get: (id: string) => unwrap<PromotionDetail>(apiClient.get(`/pricing/promotions/${id}`)),
  preview: (input: PromotionInput, excludeId?: string) =>
    unwrap<PromotionPreview>(
      apiClient.post('/pricing/promotions/preview', input, { params: excludeId ? { excludeId } : undefined }),
    ),
  create: (input: PromotionInput) => unwrap<PromotionDetail>(apiClient.post('/pricing/promotions', input)),
  update: (id: string, input: Partial<PromotionInput>) =>
    unwrap<PromotionDetail>(apiClient.patch(`/pricing/promotions/${id}`, input)),
  setActive: (id: string, on: boolean) =>
    unwrap<PromotionDetail>(apiClient.post(`/pricing/promotions/${id}/${on ? 'activate' : 'deactivate'}`)),
  targetAction: (id: string, propertyId: string, action: 'activate' | 'deactivate' | 'retry') =>
    unwrap<PromotionDetail>(apiClient.post(`/pricing/promotions/${id}/properties/${propertyId}/${action}`)),
  calendar: (from: string, to: string) =>
    unwrap<CalendarPromotion[]>(apiClient.get('/pricing/calendar', { params: { from, to } })),
  rules: {
    list: () => unwrap<RuleView[]>(apiClient.get('/pricing/rules')),
    create: (input: RuleInput) => unwrap<RuleView>(apiClient.post('/pricing/rules', input)),
    setActive: (groupId: string, on: boolean) =>
      unwrap<RuleView>(apiClient.post(`/pricing/rules/${groupId}/${on ? 'activate' : 'deactivate'}`)),
    setPropertyActive: (groupId: string, propertyId: string, on: boolean) =>
      unwrap<RuleView>(
        apiClient.post(`/pricing/rules/${groupId}/properties/${propertyId}/${on ? 'activate' : 'deactivate'}`),
      ),
    resend: (groupId: string) => unwrap<RuleView>(apiClient.post(`/pricing/rules/${groupId}/resend`)),
  },
};
