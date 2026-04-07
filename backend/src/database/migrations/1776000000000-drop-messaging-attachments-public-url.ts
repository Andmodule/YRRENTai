import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropMessagingAttachmentsPublicUrl1776000000000 implements MigrationInterface {
  name = 'DropMessagingAttachmentsPublicUrl1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messaging_attachments" DROP COLUMN IF EXISTS "public_url"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messaging_attachments" ADD COLUMN IF NOT EXISTS "public_url" text`,
    );
  }
}
