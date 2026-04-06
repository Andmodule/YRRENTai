import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PropertyService } from '../property/property.service';

/**
 * Meta WhatsApp Cloud API — outbound text to guests (AI + staff replies).
 */
@Injectable()
export class WhatsappCloudApiService {
  private readonly logger = new Logger(WhatsappCloudApiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly propertyService: PropertyService,
  ) {}

  private graphBase(phoneNumberId: string): string {
    const ver = this.configService.get<string>('WHATSAPP_GRAPH_API_VERSION') ?? 'v21.0';
    return `https://graph.facebook.com/${ver}/${phoneNumberId}`;
  }

  private resolveToken(property: { whatsappAccessToken?: string | null }): string | null {
    const fromProp = property.whatsappAccessToken?.trim();
    if (fromProp) return fromProp;
    return this.configService.get<string>('WHATSAPP_DEFAULT_ACCESS_TOKEN')?.trim() || null;
  }

  /** `externalGuestKey` format: `wa:<digits>`. */
  parseDigitsFromWaExternalKey(raw: string | undefined | null): string | null {
    const t = raw?.trim();
    if (!t?.toLowerCase().startsWith('wa:')) return null;
    const d = t.slice(3).replace(/\D/g, '');
    return d.length ? d : null;
  }

  async sendTextToGuest(propertyId: string, externalGuestKey: string | undefined, text: string): Promise<void> {
    const property = await this.propertyService.findByIdBare(propertyId);
    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }
    const phoneNumberId = property.whatsappPhoneNumberId?.trim();
    const token = this.resolveToken(property);
    if (!phoneNumberId || !token) {
      throw new Error('WhatsApp is not configured for this property (phone number id / token)');
    }
    const to = this.parseDigitsFromWaExternalKey(externalGuestKey);
    if (!to) {
      throw new Error('Invalid WhatsApp guest key (expected wa:<phone>)');
    }
    const body = text.length > 4096 ? `${text.slice(0, 4093)}…` : text;
    const url = `${this.graphBase(phoneNumberId)}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );
    this.logger.log(`WhatsApp outbound OK property=${propertyId} to=${to.slice(0, 4)}…`);
  }

  async sendAssistantReplyToGuest(
    propertyId: string,
    externalGuestKey: string | undefined,
    text: string,
  ): Promise<void> {
    await this.sendTextToGuest(propertyId, externalGuestKey, text);
  }
}
