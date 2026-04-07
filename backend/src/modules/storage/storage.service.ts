import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('R2_ENDPOINT')?.trim();
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.s3 = null;
      return;
    }
    /** R2 is S3-compatible but does not implement flexible checksum headers (SDK ≥3.729 defaults break PutObject). */
    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
      }),
    );

    return { key: fileKey };
  }
}
