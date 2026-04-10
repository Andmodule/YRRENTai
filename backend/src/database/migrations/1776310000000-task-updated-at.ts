import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskUpdatedAt1776310000000 implements MigrationInterface {
  name = 'TaskUpdatedAt1776310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ`);
    await queryRunner.query(`UPDATE "tasks" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "updatedAt" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "updatedAt"`);
  }
}
