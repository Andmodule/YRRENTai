import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PropertyEntity } from '../../property/entities/property.entity';
import { PropertyService } from '../../property/property.service';
import { ZodomusService } from './zodomus.service';
import { ZodomusSyncService } from './zodomus-sync.service';
import { formatZodomusHttpException } from './zodomus-status.util';
import type { ZodomusRoomActivationRoom } from './zodomus.types';
import { extractRoomsFromRoomRatesBody } from './zodomus-room-rates.util';

export type ZodomusMappingStepName =
  | 'cancel'
  | 'activate'
  | 'roomRates'
  | 'roomsActivation'
  | 'propertyCheck'
  | 'importSummary'
  | 'queueSync';

export type ZodomusMappingStep = {
  step: ZodomusMappingStepName;
  ok: boolean;
  detail?: string;
};

export type ZodomusMappingResult = {
  propertyId: string;
  channelId: number;
  externalPropertyId: string;
  steps: ZodomusMappingStep[];
  zodomusStatus: string | null;
};

function messageOf(e: unknown): string {
  return formatZodomusHttpException(e);
}

function isAlreadyExistsError(detail: string): boolean {
  const t = detail.toLowerCase();
  return (
    t.includes('already') ||
    t.includes('exists in database') ||
    t.includes('cannot activate an existing') ||
    t.includes('property id exists')
  );
}

function buildRoomsFromRatesBody(
  ratesBody: unknown,
  preferRoomId?: string | null,
): ZodomusRoomActivationRoom[] {
  return extractRoomsFromRoomRatesBody(ratesBody, preferRoomId).map((r) => ({
    roomId: r.roomId,
    roomName: r.roomName,
    quantity: r.quantity,
    status: 1,
    rates: r.rates,
  }));
}

/**
 * Full Zodomus Mapping API orchestration (docs order):
 * cancel → activate → room-rates → rooms-activation → property-check → import.
 */
@Injectable()
export class ZodomusMappingService {
  private readonly logger = new Logger(ZodomusMappingService.name);

  constructor(
    private readonly zodomus: ZodomusService,
    private readonly zodomusSync: ZodomusSyncService,
    private readonly propertyService: PropertyService,
    private readonly config: ConfigService,
  ) {}

  async bindPropertyMapping(
    property: PropertyEntity,
    channelId: number,
    opts?: { remap?: boolean; priceModelId?: number; skipImport?: boolean },
  ): Promise<ZodomusMappingResult> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const extId = this.propertyService.getExternalListingIdForZodomusChannel(property, channelId);
    if (!extId) {
      throw new BadRequestException('Property has no external listing id for this channel');
    }

    const remap = opts?.remap !== false;
    const priceModelId =
      opts?.priceModelId ??
      this.config.get<number>('ZODOMUS_PRICE_MODEL_ID') ??
      1;
    const preferRoomId = this.propertyService.getZodomusRoomIdForChannel(property, channelId);
    const steps: ZodomusMappingStep[] = [];

    if (remap) {
      try {
        await this.zodomus.cancelProperty(channelId, extId);
        steps.push({ step: 'cancel', ok: true });
      } catch (e) {
        const detail = messageOf(e);
        // Not mapped yet — continue.
        steps.push({ step: 'cancel', ok: true, detail: `skip: ${detail}` });
        this.logger.warn(`bind mapping cancel skipped property=${property.id}: ${detail}`);
      }
    }

    try {
      await this.zodomus.activateProperty(channelId, extId, priceModelId);
      steps.push({ step: 'activate', ok: true, detail: `priceModelId=${priceModelId}` });
    } catch (e) {
      const detail = messageOf(e);
      if (isAlreadyExistsError(detail)) {
        try {
          await this.zodomus.cancelProperty(channelId, extId);
          steps.push({ step: 'cancel', ok: true, detail: 'retry before re-activate' });
          await this.zodomus.activateProperty(channelId, extId, priceModelId);
          steps.push({ step: 'activate', ok: true, detail: `re-activated priceModelId=${priceModelId}` });
        } catch (e2) {
          steps.push({ step: 'activate', ok: false, detail: messageOf(e2) });
          throw new BadGatewayException({
            error: 'ZODOMUS_PROPERTY_ACTIVATION_FAILED',
            message: messageOf(e2),
            steps,
          });
        }
      } else {
        steps.push({ step: 'activate', ok: false, detail });
        throw new BadGatewayException({
          error: 'ZODOMUS_PROPERTY_ACTIVATION_FAILED',
          message: detail,
          steps,
        });
      }
    }

    let rooms: ZodomusRoomActivationRoom[] = [];
    try {
      const ratesBody = await this.zodomus.getRoomRatesRaw(channelId, extId);
      rooms = buildRoomsFromRatesBody(ratesBody, preferRoomId);
      steps.push({
        step: 'roomRates',
        ok: rooms.length > 0,
        detail: `rooms=${rooms.length} rates=${rooms.reduce((a, r) => a + r.rates.length, 0)}`,
      });
    } catch (e) {
      const detail = messageOf(e);
      steps.push({ step: 'roomRates', ok: false, detail });
      throw new BadGatewayException({
        error: 'ZODOMUS_ROOM_RATES_FAILED',
        message: detail,
        steps,
      });
    }

    if (rooms.length === 0) {
      steps.push({ step: 'roomsActivation', ok: false, detail: 'no rooms/rates from room-rates' });
      throw new BadGatewayException({
        error: 'ZODOMUS_ROOMS_ACTIVATION_FAILED',
        message: 'No rooms/rates returned from GET /room-rates',
        steps,
      });
    }

    try {
      await this.zodomus.activateRooms(channelId, extId, rooms);
      steps.push({ step: 'roomsActivation', ok: true, detail: `rooms=${rooms.length}` });
    } catch (e) {
      // Retry with first rate only (Booking often rejects child/promo rates).
      const firstOnly = rooms
        .map((r) => ({ ...r, rates: r.rates.slice(0, 1) }))
        .filter((r) => r.rates.length > 0);
      try {
        await this.zodomus.activateRooms(channelId, extId, firstOnly);
        steps.push({
          step: 'roomsActivation',
          ok: true,
          detail: `fallback first-rate rooms=${firstOnly.length}; prior=${messageOf(e)}`,
        });
      } catch (e2) {
        steps.push({ step: 'roomsActivation', ok: false, detail: messageOf(e2) });
        throw new BadGatewayException({
          error: 'ZODOMUS_ROOMS_ACTIVATION_FAILED',
          message: messageOf(e2),
          steps,
        });
      }
    }

    try {
      await this.zodomusSync.refreshPropertyStatuses({
        channelId,
        properties: [property],
      });
      steps.push({ step: 'propertyCheck', ok: true });
    } catch (e) {
      steps.push({ step: 'propertyCheck', ok: false, detail: messageOf(e) });
      this.logger.warn(`bind mapping property-check failed property=${property.id}: ${messageOf(e)}`);
    }

    if (!opts?.skipImport) {
      try {
        const summary = await this.zodomusSync.importSummaryForProperty(
          property.ownerId,
          property.id,
          channelId,
        );
        steps.push({
          step: 'importSummary',
          ok: true,
          detail: `imported=${summary.imported} failed=${summary.failed}`,
        });
      } catch (e) {
        steps.push({ step: 'importSummary', ok: false, detail: messageOf(e) });
        this.logger.warn(`bind mapping summary import failed property=${property.id}: ${messageOf(e)}`);
      }

      try {
        const queue = await this.zodomusSync.syncQueueForProperty(
          property.ownerId,
          property.id,
          channelId,
          true,
        );
        steps.push({
          step: 'queueSync',
          ok: true,
          detail: `processed=${queue.processed} skipped=${queue.skipped} failed=${queue.failed}`,
        });
      } catch (e) {
        steps.push({ step: 'queueSync', ok: false, detail: messageOf(e) });
        this.logger.warn(`bind mapping queue sync failed property=${property.id}: ${messageOf(e)}`);
      }
    }

    const fresh = await this.propertyService.findByIdBare(property.id);
    this.logger.log(
      `bind mapping done property=${property.id} ext=${extId} channel=${channelId} status=${fresh?.zodomusStatus ?? 'null'}`,
    );

    return {
      propertyId: property.id,
      channelId,
      externalPropertyId: extId,
      steps,
      zodomusStatus: fresh?.zodomusStatus ?? null,
    };
  }
}
