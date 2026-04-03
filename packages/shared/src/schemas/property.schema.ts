import { z } from 'zod';

export const propertyChannelListingSchema = z.object({
  otaPlatformId: z.string().uuid(),
  externalListingId: z.string().trim().min(1).max(255),
  zodomusRoomId: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return null;
      const t = String(val).trim();
      return t === '' ? null : t;
    },
    z.union([z.string().max(64), z.null()]).optional(),
  ),
});

function refineDuplicateChannels(data: { channelListings: { otaPlatformId: string }[] }, ctx: z.RefinementCtx) {
  const ids = data.channelListings.map((x) => x.otaPlatformId);
  if (ids.length !== new Set(ids).size) {
    ctx.addIssue({
      code: 'custom',
      path: ['channelListings'],
      message: 'duplicate_ota_channel',
    });
  }
}

const propertyFieldsSchema = z.object({
  name: z.string().min(1).max(255),
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  address: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  timezone: z.string().min(1).max(100),
  currency: z.string().length(3).default('USD'),
  maxGuests: z.number().int().positive().max(100).optional(),
  /**
   * Подключённые каналы продаж: на каждый канал — обязательный внешний id объекта в этом канале.
   */
  channelListings: z.array(propertyChannelListingSchema).max(16).default([]),
  /**
   * External iCal feed URLs (Airbnb, VRBO, etc.) — one row per URL in the UI.
   * Stored as jsonb on the property; backend syncs into bookings.
   */
  icalImportUrls: z
    .array(z.string().min(1).max(2048))
    .max(32)
    .optional()
    .default([]),
});

export const createPropertySchema = propertyFieldsSchema.superRefine(refineDuplicateChannels);

export const updatePropertySchema = propertyFieldsSchema.partial().superRefine((data, ctx) => {
  if (data.channelListings === undefined) return;
  refineDuplicateChannels(
    { channelListings: data.channelListings },
    ctx,
  );
});
