import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  type InboundAttachmentFile,
  type InboundAttachmentMeta,
  parseResendInboundAttachments,
} from './inbound-attachments.util';

@Injectable()
export class ReplySenderService implements OnModuleInit {
  private readonly logger = new Logger(ReplySenderService.name);
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
  }

  onModuleInit(): void {
    const key = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    if (!key?.trim() || !from?.trim()) {
      this.logger.warn(
        'Outbound email disabled: set RESEND_API_KEY and RESEND_FROM_EMAIL (AI replies and staff relay will fail).',
      );
      return;
    }
    if (!this.resend) {
      this.logger.warn('Outbound email: RESEND_API_KEY is set but Resend client did not initialize.');
      return;
    }
    this.logger.log(`Outbound email ready (from: ${from})`);
  }

  async send(replyTo: string, text: string): Promise<void> {
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    const key = this.config.get<string>('RESEND_API_KEY');
    if (!key || !from) {
      throw new Error('RESEND_API_KEY and RESEND_FROM_EMAIL must be set to send email');
    }
    if (!this.resend) {
      throw new Error('Resend client not initialized');
    }
    try {
      const result = await this.resend.emails.send({
        from,
        to: replyTo,
        subject: 'Re: Your booking inquiry',
        text,
      });
      if (result.error) {
        this.logger.error(`Resend API error: ${result.error.message}`);
        throw new Error(result.error.message);
      }
      const resendId =
        result.data &&
        typeof result.data === 'object' &&
        result.data !== null &&
        'id' in result.data &&
        typeof (result.data as { id: unknown }).id === 'string'
          ? (result.data as { id: string }).id
          : null;
      this.logger.log(
        `Sent reply to ${replyTo}${resendId ? ` resendId=${resendId}` : ''} (search this id in Resend → Emails)`,
      );
    } catch (err) {
      this.logger.error(`Resend send failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Inbound webhooks do not include the body (only metadata). Fetch text/html via Received Emails API.
   * @see https://resend.com/docs/webhooks/emails/received
   */
  async fetchReceivedEmailBody(
    emailId: string,
  ): Promise<{
    text: string | null;
    html: string | null;
    subject: string | null;
    attachments: InboundAttachmentMeta[];
  } | null> {
    const key = this.config.get<string>('RESEND_API_KEY');
    if (!key) {
      this.logger.warn('fetchReceivedEmailBody: RESEND_API_KEY missing');
      return null;
    }
    const url = `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const raw = await res.text();
      if (!res.ok) {
        this.logger.error(`Resend receiving GET ${res.status}: ${raw.slice(0, 500)}`);
        return null;
      }
      const json = JSON.parse(raw) as Record<string, unknown>;
      const inner =
        json.data && typeof json.data === 'object' && json.data !== null
          ? (json.data as Record<string, unknown>)
          : json;
      const t = inner.text;
      const h = inner.html;
      const sub = inner.subject;
      const attachments = parseResendInboundAttachments(inner.attachments);
      return {
        text: typeof t === 'string' ? t : null,
        html: typeof h === 'string' ? h : null,
        subject: typeof sub === 'string' ? sub : null,
        attachments,
      };
    } catch (err) {
      this.logger.error(`fetchReceivedEmailBody failed for ${emailId}`, err as Error);
      return null;
    }
  }

  /**
   * Lists attachments for a received email and downloads each via `download_url` (short-lived CDN URL).
   * @see https://resend.com/docs/api-reference/emails/list-received-email-attachments
   */
  async fetchReceivedEmailAttachmentFiles(emailId: string): Promise<InboundAttachmentFile[]> {
    const key = this.config.get<string>('RESEND_API_KEY');
    if (!key?.trim()) {
      this.logger.warn('fetchReceivedEmailAttachmentFiles: RESEND_API_KEY missing');
      return [];
    }
    const listUrl = `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`;
    try {
      const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const raw = await res.text();
      if (!res.ok) {
        this.logger.error(`Resend attachments list ${res.status}: ${raw.slice(0, 500)}`);
        return [];
      }
      const json = JSON.parse(raw) as { data?: unknown };
      const rows = Array.isArray(json.data) ? json.data : [];
      const out: InboundAttachmentFile[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const filename =
          (typeof o.filename === 'string' && o.filename.trim()) ||
          (typeof o.name === 'string' && o.name.trim()) ||
          '';
        const downloadUrl = typeof o.download_url === 'string' ? o.download_url.trim() : '';
        if (!filename || !downloadUrl) continue;
        const dl = await fetch(downloadUrl);
        if (!dl.ok) {
          this.logger.error(
            `Attachment download failed ${filename}: HTTP ${dl.status} ${(await dl.text()).slice(0, 200)}`,
          );
          continue;
        }
        const buffer = Buffer.from(await dl.arrayBuffer());
        const contentType =
          typeof o.content_type === 'string' && o.content_type.trim()
            ? o.content_type.trim()
            : dl.headers.get('content-type')?.trim() || 'application/octet-stream';
        let sizeBytes = buffer.length;
        if (typeof o.size === 'number' && Number.isFinite(o.size)) {
          sizeBytes = o.size;
        }
        out.push({ filename, contentType, sizeBytes, buffer });
      }
      return out;
    } catch (err) {
      this.logger.error(`fetchReceivedEmailAttachmentFiles failed for ${emailId}`, err as Error);
      return [];
    }
  }
}
