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

function makeService(opts: { getPromotions: jest.Mock; previous?: { promotionsAccess: string } | null }) {
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(opts.previous ?? null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const targetRepo = { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
  const service = new PromotionSyncService(
    { flags: { enabled: true, dryRun: true, channelId: 1, gapMs: 0, syncMinutes: 30 } } as never,
    { getPromotions: opts.getPromotions } as never,
    { getExternalListingIdForZodomusChannel: () => '12345' } as never,
    {} as never,
    targetRepo as never,
    {} as never,
    settingsRepo as never,
  );
  return { service, settingsRepo };
}

const PROPERTY = { id: 'p1', timezone: 'Europe/Warsaw' } as PropertyEntity;

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
