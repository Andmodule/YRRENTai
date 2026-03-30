import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEscalationKbProcessingStatus1772419200000 implements MigrationInterface {
  name = 'AddEscalationKbProcessingStatus1772419200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD COLUMN IF NOT EXISTS "kbProcessingStatus" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escalations" DROP COLUMN IF EXISTS "kbProcessingStatus"`,
    );
  }
}
