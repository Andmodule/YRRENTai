import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskIncidentId1775400000000 implements MigrationInterface {
  name = 'TaskIncidentId1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "incidentId" uuid`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "tasks"
          ADD CONSTRAINT "FK_tasks_incidentId"
          FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_incidentId" ON "tasks" ("incidentId") WHERE "incidentId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_incidentId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_incidentId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "incidentId"`);
  }
}
