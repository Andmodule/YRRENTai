import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffInterpVoiceLinkedIncident1776600000000 implements MigrationInterface {
  name = 'StaffInterpVoiceLinkedIncident1776600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_interpretation_events"
      ADD COLUMN IF NOT EXISTS "voiceLinkedIncidentId" uuid NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_interpretation_events" DROP COLUMN IF EXISTS "voiceLinkedIncidentId"`,
    );
  }
}
