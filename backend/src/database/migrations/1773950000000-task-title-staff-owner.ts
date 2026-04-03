import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskTitleStaffOwner1773950000000 implements MigrationInterface {
  name = 'TaskTitleStaffOwner1773950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Link staff/manager users to an owner account
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employerOwnerId" uuid NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_employerOwnerId" ON "users" ("employerOwnerId")`,
    );

    // 2. Add title column to tasks (nullable for safe backfill)
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "title" character varying(255) NULL`,
    );

    // 3. Backfill title from existing contextLabel → notes → fallback
    await queryRunner.query(`
      UPDATE "tasks"
      SET "title" = COALESCE(
        NULLIF(TRIM("contextLabel"), ''),
        NULLIF(TRIM("notes"), ''),
        'Task'
      )
      WHERE "title" IS NULL
    `);

    // 4. Make title NOT NULL
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "title" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "title" SET DEFAULT ''`,
    );

    // 5. Migrate deprecated priority value: low → normal
    await queryRunner.query(
      `UPDATE "tasks" SET "priority" = 'normal' WHERE "priority" = 'low'`,
    );

    // 6. Migrate deprecated type value: manual → other
    await queryRunner.query(
      `UPDATE "tasks" SET "type" = 'other' WHERE "type" = 'manual'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "title"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_employerOwnerId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "employerOwnerId"`);
  }
}
