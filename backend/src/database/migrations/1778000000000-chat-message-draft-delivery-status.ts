import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI reply approval mode: assistant rows can stay as DRAFT until a manager confirms.
 */
export class ChatMessageDraftDeliveryStatus1778000000000 implements MigrationInterface {
  name = 'ChatMessageDraftDeliveryStatus1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "chat_messages_delivery_status_enum" ADD VALUE IF NOT EXISTS 'DRAFT'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values safely; no-op.
  }
}
