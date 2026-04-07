import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    const rawEndpoint = this.config.get<string>('R2_ENDPOINT')?.trim();
    const endpoint = rawEndpoint?.replace(/\/+$/, '') ?? '';
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.s3 = null;
      return;
    }
    const forcePathStyle = this.config.get<boolean>('R2_FORCE_PATH_STYLE') ?? true;
    /**
     * R2 + S3 API: path-style (`…/bucket/key`) avoids many `AccessDenied` responses with API tokens
     * that only match the account endpoint. Virtual-hosted (`bucket.account…`) can 403 until token/bucket
     * alignment is exact — see `R2_FORCE_PATH_STYLE`.
     *
     * AWS SDK ≥3.729: keep `WHEN_SUPPORTED` (not `WHEN_REQUIRED`) so PutObject does not force flexible
     * checksum headers R2 rejects.
     */
    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
      requestChecksumCalculation: 'WHEN_SUPPORTED',
      responseChecksumValidation: 'WHEN_SUPPORTED',
    });
  }

  isConfigured(): boolean {
    const bucket = this.config.get<string>('R2_BUCKET_NAME')?.trim();
    return !!this.s3 && !!bucket;
  }

  /**
   * Temporary GET URL for a private object (R2 / S3-compatible).
   * @param expiresInSeconds default 15 minutes
   */
  async getPresignedDownloadUrl(fileKey: string, expiresInSeconds = 900): Promise<string> {
    if (!this.s3) {
      throw new Error('R2 storage is not configured (missing R2_ENDPOINT or credentials)');
    }
    const bucket = this.config.get<string>('R2_BUCKET_NAME')?.trim();
    if (!bucket) {
      throw new Error('R2_BUCKET_NAME is required');
    }
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  async uploadAttachment(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<{ key: string }> {
    if (!this.s3) {
      throw new Error('R2 storage is not configured (missing R2_ENDPOINT or credentials)');
    }
    const bucket = this.config.get<string>('R2_BUCKET_NAME')?.trim();
    if (!bucket) {
      throw new Error('R2_BUCKET_NAME is required for uploads');
    }

    const safeName = originalName.replace(/\s+/g, '_').replace(/[/\\]/g, '_');
    const fileKey = `attachments/${uuidv4()}-${safeName}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileKey,
          Body: buffer,
          ContentType: mimeType || 'application/octet-stream',
        }),
      );
    } catch (e) {
      const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const denied =
        err.name === 'AccessDenied' || err.Code === 'AccessDenied' || err.message?.includes('Access Denied');
      if (denied) {
        const hint =
          'R2 rejected PutObject (AccessDenied). Fix in Cloudflare: R2 → bucket → API token must allow ' +
          '`Object Read & Write` for this exact bucket; R2_BUCKET_NAME must match bucket name; ' +
          `R2_ENDPOINT host must be https://<same_account_id>.r2.cloudflarestorage.com. ` +
          `If it still fails, try R2_FORCE_PATH_STYLE=true (default) vs false. HTTP=${err.$metadata?.httpStatusCode ?? 'n/a'}`;
        this.logger.warn(hint);
        throw new Error(`${hint} — ${err.message ?? 'AccessDenied'}`);
      }
      throw e;
    }

    return { key: fileKey };
  }
}
