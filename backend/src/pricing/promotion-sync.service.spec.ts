import { HttpException } from '@nestjs/common';
import { PromotionSyncService } from './promotion-sync.service';
import type { PropertyEntity } from '../property/entities/property.entity';

/** Zodomus answers HTTP 200 with an error inside — what `assertZodomusSuccess` throws. */
function zodomusBodyError(message: string): HttpException {
  return new HttpException(
    {
      message: `Zodomus API error (GET /promotions): returnCode=400 — ${message}`,
      upstream: 'zodomus',
      returnCode: 400,
      detail: message,
    },
    502,
  );
}

function makeService(opts: {
  getPromotions: jest.Mock;
  previous?: { promotionsAccess: string } | null;
  targets?: unknown[];
}) {
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(opts.previous ?? null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const targetRepo = { find: jest.fn().mockResolvedValue(opts.targets ?? []), update: jest.fn() };
  const service = new PromotionSyncService(
    { flags: { enabled: true, dryRun: true, channelId: 1, gapMs: 0, syncMinutes: 30 } } as never,
    { getPromotions: opts.getPromotions } as never,
    { getExternalListingIdForZodomusChannel: () => '12345' } as never,
    {} as never,
    targetRepo as never,
    {} as never,
    settingsRepo as never,
  );
  return { service, settingsRepo, targetRepo };
}

function ourTarget(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    promotionId: 'promo-1',
    propertyId: 'p1',
    desiredState: 'on',
    state: 'on',
    externalPromotionId: 'VR1',
    previousExternalIds: [],
    verifiedAt: null,
    verifyNote: null,
    stats: null,
    promotion: { source: 'rentai', name: 'Осень' },
    ...over,
  };
}

const LISTED = { promotions: [{ '@attributes': { id: 'VR1', name: 'RentAI 1a2b3c4d-1' } }] };

const PROPERTY = { id: 'p1', timezone: 'Europe/Warsaw' } as PropertyEntity;

describe('PromotionSyncService.syncProperty — is our discount really on Booking', () => {
  it('found in Booking\'s list → confirmed', async () => {
    const { service, targetRepo } = makeService({
      getPromotions: jest.fn().mockResolvedValue(LISTED),
      targets: [ourTarget({ verifyNote: 'NOT_FOUND: акции нет в списке активных на Booking' })],
    });
    await service.syncProperty(PROPERTY);
    const [id, patch] = targetRepo.update.mock.calls[0]!;
    expect(id).toBe('t1');
    expect(patch.verifiedAt).toBeInstanceOf(Date);
    expect(patch.verifyNote).toBeNull();
  });

  it('a parameter mismatch found after the push is not silently forgiven', async () => {
    const { service, targetRepo } = makeService({
      getPromotions: jest.fn().mockResolvedValue(LISTED),
      targets: [ourTarget({ verifyNote: 'MISMATCH: скидка на Booking 5% вместо 10%' })],
    });
    await service.syncProperty(PROPERTY);
    const patch = targetRepo.update.mock.calls[0]![1];
    expect(patch).not.toHaveProperty('verifiedAt');
    expect(patch).not.toHaveProperty('verifyNote');
  });

  it('not in Booking\'s list any more → the confirmation is withdrawn', async () => {
    const { service, targetRepo } = makeService({
      getPromotions: jest.fn().mockResolvedValue({ promotions: [] }),
      targets: [ourTarget({ verifiedAt: new Date() })],
    });
    await service.syncProperty(PROPERTY);
    expect(targetRepo.update.mock.calls[0]![1]).toMatchObject({
      verifiedAt: null,
      verifyNote: expect.stringContaining('NOT_FOUND_ON_SYNC'),
    });
  });

  it('reads the Mobile / Country rate of each property from extranet promotions', async () => {
    const booking = (propertyId: string, promotionType: string, discountPct: number) => ({
      propertyId,
      state: 'on',
      promotion: { source: 'booking', status: 'active', promotionType, discountPct },
    });
    const { service, targetRepo } = makeService({
      getPromotions: jest.fn(),
      targets: [booking('p1', 'mobile_rate', 10), booking('p1', 'basic', 12), booking('p2', 'geo_rate', 7)],
    });
    expect([...(await service.targetingPctMap(['p1', 'p2', 'p3']))]).toEqual([
      ['p1', 10],
      ['p2', 7],
    ]);
    expect(await service.targetingPctMap([])).toEqual(new Map());
    expect(targetRepo.find).toHaveBeenCalledTimes(1);
  });
});

describe('PromotionSyncService.syncProperty — failed check', () => {
  it('records the unrecognised Zodomus answer with time, so the UI can show it', async () => {
    const { service, settingsRepo } = makeService({
      getPromotions: jest.fn().mockRejectedValue(zodomusBodyError('Something unexpected')),
    });

    const out = await service.syncProperty(PROPERTY);

    expect(out).toEqual({ propertyId: 'p1', access: 'unknown', code: 'UNKNOWN' });
    const [row] = settingsRepo.upsert.mock.calls[0]!;
    expect(row).toMatchObject({ propertyId: 'p1', promotionsAccess: 'unknown', promotionsAccessCode: 'UNKNOWN' });
    expect(row.promotionsAccessDetail).toContain('Something unexpected');
    expect(row.promotionsAccessCheckedAt).toBeInstanceOf(Date);
  });

  it('keeps a previously confirmed access on a temporary failure', async () => {
    const { service, settingsRepo } = makeService({
      getPromotions: jest.fn().mockRejectedValue(zodomusBodyError('Something unexpected')),
      previous: { promotionsAccess: 'ok' },
    });

    await service.syncProperty(PROPERTY);

    expect(settingsRepo.upsert.mock.calls[0]![0]).toMatchObject({ promotionsAccess: 'ok', promotionsAccessCode: 'UNKNOWN' });
  });

  it('a successful check clears the previous error', async () => {
    const { service, settingsRepo } = makeService({
      getPromotions: jest.fn().mockResolvedValue({ promotions: [] }),
      previous: { promotionsAccess: 'unknown' },
    });

    const out = await service.syncProperty(PROPERTY);

    expect(out).toEqual({ propertyId: 'p1', access: 'ok' });
    expect(settingsRepo.upsert.mock.calls[0]![0]).toMatchObject({
      promotionsAccess: 'ok',
      promotionsAccessCode: null,
      promotionsAccessDetail: null,
    });
  });
});
