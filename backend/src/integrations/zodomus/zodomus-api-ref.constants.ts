/**
 * Allowlisted Zodomus upstream paths from public API Reference
 * (doc/zodomus/documentationzodomus). Used by CRM api-ref invoke.
 *
 * Excluded on purpose: GET /reservations-cc (PCI / card data).
 */

export type ZodomusApiRefScope = 'account' | 'property' | 'none';

/** Where to place CRM `zodomusRoomId` / explorer roomId for room-scoped ops. */
export type ZodomusApiRefRoomIdPlacement =
  | 'query'
  | 'body'
  | 'bodyRoomIds'
  | 'bodyRooms';

export type ZodomusApiRefEntry = {
  /** Upstream path, e.g. `/account` */
  path: string;
  method: 'GET' | 'POST';
  /** Section in Zodomus docs */
  group: string;
  description: string;
  /**
   * account — no property
   * property — injects external listing id (query GET / body POST) after tenant check
   * none — caller supplies all params in query/body (still needs propertyId when channel+property are in query)
   */
  scope: ZodomusApiRefScope;
  /** When true, CRM must pass RentAI propertyId (ownership checked). */
  requiresRentaiProperty: boolean;
  /**
   * When true, operation needs a Zodomus room id (docs: channel / property / room).
   * Explorer prefills from property `zodomusRoomId`; invoke injects if missing.
   */
  requiresRoomId?: boolean;
  /** How to inject roomId into query/body. Default `body` when requiresRoomId. */
  roomIdPlacement?: ZodomusApiRefRoomIdPlacement;
};

export const ZODOMUS_API_REF_CATALOG: readonly ZodomusApiRefEntry[] = [
  // Account
  { path: '/account', method: 'GET', group: 'account', description: 'Get account information', scope: 'account', requiresRentaiProperty: false },
  { path: '/channels', method: 'GET', group: 'account', description: 'List active channels', scope: 'account', requiresRentaiProperty: false },
  { path: '/currencies', method: 'GET', group: 'account', description: 'List currencies', scope: 'account', requiresRentaiProperty: false },
  { path: '/price-model', method: 'GET', group: 'account', description: 'List price models', scope: 'account', requiresRentaiProperty: false },

  // Mapping
  { path: '/property-activation', method: 'POST', group: 'mapping', description: 'Activate channel property', scope: 'property', requiresRentaiProperty: true },
  { path: '/property-cancellation', method: 'POST', group: 'mapping', description: 'Cancel channel property mapping', scope: 'property', requiresRentaiProperty: true },
  { path: '/property-check', method: 'POST', group: 'mapping', description: 'Check property with Zodomus', scope: 'property', requiresRentaiProperty: true },
  {
    path: '/rooms-activation',
    method: 'POST',
    group: 'mapping',
    description: 'Activate rooms and rates mapping (rooms[].roomId)',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'bodyRooms',
  },
  {
    path: '/rooms-cancellation',
    method: 'POST',
    group: 'mapping',
    description: 'Cancel rooms associated with Zodomus (rooms[].roomId)',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'bodyRooms',
  },

  // Airbnb mapping
  { path: '/airbnb-host-activation', method: 'POST', group: 'airbnb', description: 'Activate Airbnb host', scope: 'none', requiresRentaiProperty: false },
  { path: '/airbnb-host-cancellation', method: 'POST', group: 'airbnb', description: 'Cancel Airbnb host', scope: 'none', requiresRentaiProperty: false },
  { path: '/airbnb-host-status', method: 'GET', group: 'airbnb', description: 'Airbnb host status', scope: 'none', requiresRentaiProperty: false },
  { path: '/airbnb-host-info', method: 'GET', group: 'airbnb', description: 'Airbnb host account info', scope: 'none', requiresRentaiProperty: false },
  { path: '/airbnb-listings', method: 'GET', group: 'airbnb', description: 'List Airbnb host listings', scope: 'none', requiresRentaiProperty: false },

  // Rates & availability
  { path: '/room-rates', method: 'GET', group: 'rates', description: 'Rooms and rates for channel/property', scope: 'property', requiresRentaiProperty: true },
  { path: '/availability', method: 'GET', group: 'rates', description: 'Get room availability', scope: 'property', requiresRentaiProperty: true },
  {
    path: '/availability',
    method: 'POST',
    group: 'rates',
    description: 'Set availability (single range) — requires roomId',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },
  {
    path: '/availability-multiple',
    method: 'POST',
    group: 'rates',
    description: 'Set availability (multiple segments) — roomIds[].roomId',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'bodyRoomIds',
  },
  {
    path: '/rates',
    method: 'POST',
    group: 'rates',
    description: 'Set rates — requires roomId (+ rateId)',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },
  {
    path: '/rates-derived',
    method: 'POST',
    group: 'rates',
    description: 'Set derived rates — requires roomId (+ rateId)',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },

  // Reservations
  { path: '/reservations-queue', method: 'GET', group: 'reservations', description: 'Reservation queue', scope: 'property', requiresRentaiProperty: true },
  { path: '/reservations', method: 'GET', group: 'reservations', description: 'Get reservation (ACK from queue)', scope: 'property', requiresRentaiProperty: true },
  { path: '/reservations-summary', method: 'GET', group: 'reservations', description: 'Future reservations summary', scope: 'property', requiresRentaiProperty: true },
  { path: '/reservations-createtest', method: 'POST', group: 'reservations', description: 'Create sandbox test reservation', scope: 'property', requiresRentaiProperty: true },

  // Content
  { path: '/property', method: 'GET', group: 'content', description: 'Get property (Expedia)', scope: 'property', requiresRentaiProperty: true },
  { path: '/property', method: 'POST', group: 'content', description: 'Create/modify property (Booking)', scope: 'property', requiresRentaiProperty: true },
  { path: '/property-status', method: 'POST', group: 'content', description: 'Set property status (Booking)', scope: 'property', requiresRentaiProperty: true },
  {
    path: '/room',
    method: 'GET',
    group: 'content',
    description: 'Get room (Expedia) — optional roomId for one room',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'query',
  },
  {
    path: '/room',
    method: 'POST',
    group: 'content',
    description: 'Create/modify room — roomId when modifying',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },
  {
    path: '/room-status',
    method: 'POST',
    group: 'content',
    description: 'Set room status (Booking) — requires roomId',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },
  {
    path: '/rate',
    method: 'GET',
    group: 'content',
    description: 'Get rate (Expedia) — often scoped by roomId',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'query',
  },
  {
    path: '/rate',
    method: 'POST',
    group: 'content',
    description: 'Create/modify rate — requires roomId',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },
  {
    path: '/product',
    method: 'POST',
    group: 'content',
    description: 'Create/modify/delete product (Booking) — room + rate',
    scope: 'property',
    requiresRentaiProperty: true,
    requiresRoomId: true,
    roomIdPlacement: 'body',
  },

  // Booking content tables
  ...([
    '/booking-property-types',
    '/booking-room-types',
    '/booking-room-amenities',
    '/booking-breakfast-types',
    '/booking-cancellation-types',
    '/booking-cuisine-types',
    '/booking-fee-tax-policies',
    '/booking-hotel-amenities',
    '/booking-phone-types',
    '/booking-payment-types',
    '/booking-contact-types',
    '/booking-restaurant-services',
    '/booking-ambiance-types',
    '/booking-dietary-types',
    '/booking-charge-types',
    '/booking-meal-plans',
    '/booking-image-tags',
    '/booking-language-codes',
    '/booking-transportation-codes',
    '/booking-noshow-types',
    '/booking-prepayment-types',
    '/booking-parking-types',
    '/booking-parking-reservations',
    '/booking-parking-properties',
    '/booking-internet-types',
    '/booking-internet-coverages',
    '/booking-pets-allowed',
  ] as const).map((path) => ({
    path,
    method: 'GET' as const,
    group: 'booking-tables',
    description: `Booking content table ${path}`,
    scope: 'account' as const,
    requiresRentaiProperty: false,
  })),

  // Expedia content tables
  ...([
    '/expedia-room-types',
    '/expedia-views',
    '/expedia-areas',
    '/expedia-categories',
    '/expedia-featured-amenities',
    '/expedia-perstay-fees',
    '/expedia-room-classes',
    '/expedia-room-details',
    '/expedia-room-names',
    '/expedia-surcharges',
    '/expedia-value-addinclusions',
    '/expedia-value-addinclusions-corporate',
    '/expedia-bedtypes',
    '/expedia-bedtypesizes',
    '/expedia-bedsizes',
    '/expedia-amenity-codes',
  ] as const).map((path) => ({
    path,
    method: 'GET' as const,
    group: 'expedia-tables',
    description: `Expedia content table ${path}`,
    scope: 'account' as const,
    requiresRentaiProperty: false,
  })),

  // Opportunities / reviews / reporting / promotions
  { path: '/opportunities', method: 'GET', group: 'opportunities', description: 'List opportunities', scope: 'property', requiresRentaiProperty: true },
  { path: '/opportunities', method: 'POST', group: 'opportunities', description: 'Reply to opportunity', scope: 'property', requiresRentaiProperty: true },
  { path: '/reviews', method: 'GET', group: 'reviews', description: 'Guest reviews', scope: 'property', requiresRentaiProperty: true },
  { path: '/reviews-score', method: 'GET', group: 'reviews', description: 'Review score', scope: 'property', requiresRentaiProperty: true },
  { path: '/reviews', method: 'POST', group: 'reviews', description: 'Reply to guest review', scope: 'property', requiresRentaiProperty: true },
  { path: '/reporting-misconduct-categories', method: 'GET', group: 'reporting', description: 'Misconduct categories', scope: 'account', requiresRentaiProperty: false },
  { path: '/reporting', method: 'POST', group: 'reporting', description: 'Report no-show / stay change / misconduct', scope: 'property', requiresRentaiProperty: true },
  { path: '/promotions', method: 'GET', group: 'promotions', description: 'List promotions', scope: 'property', requiresRentaiProperty: true },
  { path: '/promotions', method: 'POST', group: 'promotions', description: 'Create or update promotion', scope: 'property', requiresRentaiProperty: true },
  { path: '/promotion-channels', method: 'GET', group: 'promotions', description: 'Promotion channels', scope: 'account', requiresRentaiProperty: false },
  { path: '/activate-promotion', method: 'POST', group: 'promotions', description: 'Activate promotion', scope: 'property', requiresRentaiProperty: true },
  { path: '/deactivate-promotion', method: 'POST', group: 'promotions', description: 'Deactivate promotion', scope: 'property', requiresRentaiProperty: true },
];

export function findZodomusApiRefEntry(method: string, path: string): ZodomusApiRefEntry | undefined {
  const m = method.toUpperCase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return ZODOMUS_API_REF_CATALOG.find((e) => e.method === m && e.path === p);
}

export function isZodomusApiRefAllowed(method: string, path: string): boolean {
  return Boolean(findZodomusApiRefEntry(method, path));
}

function isBlankRoomId(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * Fill missing roomId fields for room-scoped catalog ops.
 * Does not overwrite a non-empty roomId already present in query/body.
 */
export function injectZodomusApiRefRoomId(
  entry: ZodomusApiRefEntry,
  roomId: string,
  target: { query?: Record<string, string>; body?: Record<string, unknown> },
): void {
  if (!entry.requiresRoomId) return;
  const rid = roomId.trim();
  if (!rid) return;
  const placement = entry.roomIdPlacement ?? 'body';

  if (placement === 'query') {
    if (!target.query) return;
    if (isBlankRoomId(target.query.roomId)) target.query.roomId = rid;
    return;
  }

  if (!target.body) return;

  if (placement === 'body') {
    if (isBlankRoomId(target.body.roomId)) target.body.roomId = rid;
    return;
  }

  if (placement === 'bodyRoomIds') {
    const roomIds = target.body.roomIds;
    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      target.body.roomIds = [{ roomId: rid }];
      return;
    }
    target.body.roomIds = roomIds.map((item) => {
      if (!item || typeof item !== 'object') return { roomId: rid };
      const row = { ...(item as Record<string, unknown>) };
      if (isBlankRoomId(row.roomId)) row.roomId = rid;
      return row;
    });
    return;
  }

  if (placement === 'bodyRooms') {
    const rooms = target.body.rooms;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      target.body.rooms = [{ roomId: rid, roomName: 'Room', quantity: 1, status: 1, rates: [] }];
      return;
    }
    target.body.rooms = rooms.map((item) => {
      if (!item || typeof item !== 'object') {
        return { roomId: rid, roomName: 'Room', quantity: 1, status: 1, rates: [] };
      }
      const row = { ...(item as Record<string, unknown>) };
      if (isBlankRoomId(row.roomId)) row.roomId = rid;
      return row;
    });
  }
}
