import { MigrationInterface, QueryRunner } from 'typeorm';

export class EscalationAttachmentsJsonb1776100000000 implements MigrationInterface {
  name = 'EscalationAttachmentsJsonb1776100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD COLUMN IF NOT EXISTS "escalationAttachments" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN IF EXISTS "escalationAttachments"`);
  }
}
