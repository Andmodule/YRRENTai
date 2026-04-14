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

  /**
   * Staff inbox: upload one file to Meta, then send as image / document / video / audio.
   */
  async sendOneBinaryMediaToGuest(
    propertyId: string,
    externalGuestKey: string | undefined,
    file: { buffer: Buffer; mimeType: string; fileName: string },
  ): Promise<void> {
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
    const waType = WhatsappCloudApiService.waMediaTypeFromMime(file.mimeType);
    const mediaId = await this.uploadMediaToMeta(phoneNumberId, token, file.buffer, file.mimeType, file.fileName);
    const url = `${this.graphBase(phoneNumberId)}/messages`;
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: waType,
    };
    if (waType === 'document') {
      payload.document = {
        id: mediaId,
        filename: file.fileName.length > 1 ? file.fileName.slice(0, 240) : 'file',
      };
    } else {
      payload[waType] = { id: mediaId };
    }
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
    });
    this.logger.log(`WhatsApp outbound media OK property=${propertyId} type=${waType}`);
  }

  private static waMediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
    const m = mime.toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'document';
  }

  private async uploadMediaToMeta(
    phoneNumberId: string,
    token: string,
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const url = `${this.graphBase(phoneNumberId)}/media`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    form.append('file', blob, fileName);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`WhatsApp media upload failed: HTTP ${res.status} ${raw.slice(0, 800)}`);
    }
    let json: { id?: string };
    try {
      json = JSON.parse(raw) as { id?: string };
    } catch {
      throw new Error(`WhatsApp media upload: invalid JSON ${raw.slice(0, 200)}`);
    }
    if (!json.id?.trim()) {
      throw new Error('WhatsApp media upload: missing media id');
    }
    return json.id;
  }

  private graphApiRoot(): string {
    const ver = this.configService.get<string>('WHATSAPP_GRAPH_API_VERSION') ?? 'v21.0';
    return `https://graph.facebook.com/${ver}`;
  }

  /**
   * Download binary for a Meta media id (image/audio/video/document/sticker).
   */
  async fetchMediaBinary(
    propertyId: string,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const property = await this.propertyService.findByIdBare(propertyId);
    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }
    const token = this.resolveToken(property);
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }
    const metaUrl = `${this.graphApiRoot()}/${encodeURIComponent(mediaId)}`;
    const r1 = await axios.get<{ url?: string; mime_type?: string }>(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
    const downloadUrl = r1.data.url;
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      throw new Error('Meta media response missing url');
    }
    const r2 = await axios.get<ArrayBuffer>(downloadUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 120_000,
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength: 100 * 1024 * 1024,
    });
    const mimeType = r1.data.mime_type?.trim() || 'application/octet-stream';
    const ext = WhatsappCloudApiService.mimeToExt(mimeType);
    const fileName = `whatsapp-${mediaId}${ext}`;
    return { buffer: Buffer.from(r2.data), mimeType, fileName };
  }

  private static mimeToExt(mime: string): string {
    const m = mime.toLowerCase();
    if (m.includes('jpeg') || m === 'image/jpg') return '.jpg';
    if (m.includes('png')) return '.png';
    if (m.includes('webp')) return '.webp';
    if (m.includes('gif')) return '.gif';
    if (m.includes('pdf')) return '.pdf';
    if (m.includes('ogg')) return '.ogg';
    if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
    if (m.includes('mp4')) return '.mp4';
    if (m.includes('opus')) return '.opus';
    return '';
  }
}
