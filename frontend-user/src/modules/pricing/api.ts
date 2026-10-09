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
  /** «Заполненность» switched on (ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED). */
  occupancy?: boolean;
}

/** «Сдано меньше belowPct% ночей → скидка discountPct%». */
export interface OccupancyTier {
  belowPct: number;
  discountPct: number;
}

export interface OccupancySettingsInput {
  /** Nights ahead that are counted, from today. */
  horizonDays: number;
  tiers: OccupancyTier[];
}

export interface OccupancyRow {
  propertyId: string;
  name: string;
  /** Inclusive yyyy-MM-dd window that was counted. */
  from: string;
  to: string;
  totalNights: number;
  bookedNights: number;
  occupancyPct: number;
  /** null = full enough, nothing suggested. */
  suggestedPct: number | null;
  /** Largest seasonal discount already on Booking inside the window. */
  current: { promotionId: string; name: string; discountPct: number; source: PromotionSource } | null;
  /** Why a suggested discount cannot be applied. */
  blocked: 'NOT_IN_PILOT' | 'NO_ACCESS' | null;
}

export interface OccupancyOverview {
  settings: OccupancySettingsInput & { isDefault: boolean };
  properties: OccupancyRow[];
  notOnBooking: number;
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
  /** Booking lists the promotion. `state: 'on'` without it = sent, but not confirmed. */
  confirmed: boolean;
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
  /** `unconfirmed` is missing while an older backend is still being replaced during a deploy. */
  counts: Record<PromotionTargetState, number> & { total: number; unconfirmed?: number };
  stats: PromotionStatsSummary | null;
  /** Present when listed for one property (`?propertyId=`). */
  target?: PromotionTargetBrief;
}

export interface PromotionTarget {
  propertyId: string;
  propertyName: string;
  desiredState: 'on' | 'off';
  state: PromotionTargetState;
  confirmed: boolean;
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
  /** Largest Mobile / Country rate seen on Booking — stacks on top of Genius and our discount. */
  targetingPct: number | null;
  /** false = pilot mode and the property is not in the list: nothing is sent to Booking for it. */
  inPilot: boolean;
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
  excluded: { propertyId: string; name: string; reason: 'NO_BOOKING' | 'NO_ACCESS' | 'NOT_IN_PILOT' }[];
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
  properties: { propertyId: string; state: PromotionTargetState; confirmed: boolean; errorCode: string | null }[];
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
  /** Objects where Booking stored the step differently from what was sent. */
  mismatch: number;
  status: 'active' | 'off';
  derivedStatus: 'active' | 'finished' | 'off';
  counts: Record<PromotionTargetState, number> & { total: number; unconfirmed?: number };
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
  /** `confirmed: false` — a step is switched on but Booking does not list it (yet). */
  properties: { propertyId: string; propertyName: string; state: PromotionTargetState; confirmed?: boolean }[];
  /** Only on the answer to «create»: things the user should know (e.g. the old rule could not be switched off). */
  warnings?: string[];
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
  occupancy: {
    get: () => unwrap<OccupancyOverview>(apiClient.get('/pricing/occupancy')),
    saveSettings: (input: OccupancySettingsInput) =>
      unwrap<OccupancyOverview>(apiClient.patch('/pricing/occupancy/settings', input)),
  },
};
