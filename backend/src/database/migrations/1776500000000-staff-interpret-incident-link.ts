import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffInterpretIncidentLink1776500000000 implements MigrationInterface {
  name = 'StaffInterpretIncidentLink1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_interpretation_events"
      ADD COLUMN IF NOT EXISTS "skipAutoIncident" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "staff_interpretation_events"
      ADD COLUMN IF NOT EXISTS "createdIncidentId" uuid NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_interpretation_events" DROP COLUMN IF EXISTS "createdIncidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_interpretation_events" DROP COLUMN IF EXISTS "skipAutoIncident"`,
    );
  }
}
