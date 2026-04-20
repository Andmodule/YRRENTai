import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyEntity } from '../../property/entities/property.entity';
import { BookingEntity } from '../../booking/entities/booking.entity';
import { PropertyVoicePolicyService } from '../property-voice-policy.service';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Compact dynamic variables returned to Retell on the inbound webhook.
 * All values are strings — Retell does not support nested objects.
 */
export interface RetellDynamicVariables {
  /** Allows passing this object where `Record<string, string>` is expected. */
  [key: string]: string;
  property_name: string;
  property_address: string;
  wifi_info: string;
  checkin_info: string;
  checkout_info: string;
  parking_info: string;
  handoff_number: string;
  language_hint: string;
  reservation_status: string;
  guest_name: string;
  property_enabled: string; // 'true' | 'false'
  /** 'true' when no property resolved via DID — agent must ask guest for property name */
  property_resolution_required: string; // 'true' | 'false'
}

export interface CallInboundContext {
  propertyId: string | null;
  propertyName: string;
  rolloutEnabled: boolean;
  dynamicVariables: RetellDynamicVariables;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class VoiceContextBuilderService {
  private readonly logger = new Logger(VoiceContextBuilderService.name);

  constructor(
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    private readonly policyService: PropertyVoicePolicyService,
  ) {}

  /**
   * Builds compact dynamic variables for the Retell inbound call webhook.
   * Must complete fast (< 200ms target) — uses policy cache, minimal DB reads.
   *
   * Does NOT do KB vector search here — that happens per-turn in the orchestrator.
   */
  async buildInboundContext(input: {
    toNumber: string | null;
    fromNumber: string | null;
    propertyId: string | null;
    reservationId: string | null;
  }): Promise<CallInboundContext> {
    const { propertyId, reservationId, fromNumber } = input;

    if (!propertyId) {
      this.logger.warn(`No property resolved for to_number ${input.toNumber ?? 'null'}`);
      return this.fallbackContext();
    }

    const [property, policy] = await Promise.all([
      this.propertyRepo.findOne({
        where: { id: propertyId },
        select: ['id', 'name', 'address'],
      }),
      this.policyService.getOrCreatePolicy(propertyId),
    ]);

    if (!property) {
      this.logger.warn(`Property ${propertyId} not found in DB`);
      return this.fallbackContext();
    }

    let guestName = '';
    let reservationStatus = 'no_reservation';

    if (reservationId) {
      const booking = await this.bookingRepo.findOne({
        where: { id: reservationId },
        select: ['id', 'guestName', 'status', 'checkIn', 'checkOut'],
      });
      if (booking) {
        guestName = booking.guestName ?? '';
        reservationStatus = booking.status ?? 'active';
      }
    } else if (fromNumber) {
      // Attempt quick name lookup by phone
      const booking = await this.bookingRepo.findOne({
        where: { guestPhone: fromNumber },
        order: { checkIn: 'DESC' },
        select: ['id', 'guestName', 'status'],
      });
      if (booking) {
        guestName = booking.guestName ?? '';
        reservationStatus = booking.status ?? 'found';
      }
    }

    const handoffNumber =
      policy.fallbackTransferNumber ??
      (process.env['HANDOFF_TRANSFER_NUMBER'] ?? '');

    const language = policy.preferredLanguages?.split(',')[0]?.trim() ?? 'ru';

    const variables: RetellDynamicVariables = {
      property_name:                property.name ?? '',
      property_address:             String(property.address ?? ''),
      wifi_info:                    '',   // populated from KB at turn-time, not here
      checkin_info:                 '',
      checkout_info:                '',
      parking_info:                 '',
      handoff_number:               handoffNumber,
      language_hint:                language,
      reservation_status:           reservationStatus,
      guest_name:                   guestName,
      property_enabled:             policy.voiceAssistantEnabled ? 'true' : 'false',
      property_resolution_required: 'false',
    };

    return {
      propertyId,
      propertyName: property.name ?? '',
      rolloutEnabled: policy.voiceAssistantEnabled,
      dynamicVariables: variables,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private fallbackContext(): CallInboundContext {
    return {
      propertyId:     null,
      propertyName:   '',
      rolloutEnabled: false,
      dynamicVariables: {
        property_name:                '',
        property_address:             '',
        wifi_info:                    '',
        checkin_info:                 '',
        checkout_info:                '',
        parking_info:                 '',
        handoff_number:               process.env['HANDOFF_TRANSFER_NUMBER'] ?? '',
        language_hint:                'ru',
        reservation_status:           'no_reservation',
        guest_name:                   '',
        property_enabled:             'false',
        // Property is unknown — agent must ask guest for property name first
        property_resolution_required: 'true',
      },
    };
  }
}
