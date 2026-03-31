import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStaffTaskFeatures1773100000000 implements MigrationInterface {
  name = 'AddStaffTaskFeatures1773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "hasVerificationPhoto" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lastManagerSeenAt" TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "inProgressStartedAt" TIMESTAMPTZ NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staffShiftCompletedAt" TIMESTAMPTZ NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taskId" uuid NOT NULL,
        "authorId" uuid NOT NULL,
        "text" text NOT NULL,
        "photoUrl" character varying(2048) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_notes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_task_notes_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_notes_author" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_task_notes_taskId" ON "task_notes" ("taskId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_notes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "staffShiftCompletedAt"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "inProgressStartedAt"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "lastManagerSeenAt"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "hasVerificationPhoto"`);
  }
}
