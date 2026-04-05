import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskIsGeneral1775200000000 implements MigrationInterface {
  name = 'TaskIsGeneral1775200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "isGeneralTask" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "isGeneralTask"`);
  }
}
