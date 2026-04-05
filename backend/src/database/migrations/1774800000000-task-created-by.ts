import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskCreatedBy1774800000000 implements MigrationInterface {
  name = 'TaskCreatedBy1774800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "createdById" uuid NULL`);
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_createdById" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_createdById" ON "tasks" ("createdById")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_createdById"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_createdById"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "createdById"`);
  }
}
