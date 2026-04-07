import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncidentSuggestedTaskDraft1776200000000 implements MigrationInterface {
  name = 'IncidentSuggestedTaskDraft1776200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "suggestedTaskDraft" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_telegram_pending_voice_incidents" ADD COLUMN IF NOT EXISTS "suggestedTaskDraft" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_telegram_pending_voice_incidents" DROP COLUMN IF EXISTS "suggestedTaskDraft"`,
    );
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN IF EXISTS "suggestedTaskDraft"`);
  }
}
