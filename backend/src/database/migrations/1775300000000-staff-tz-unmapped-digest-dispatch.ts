import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffTzUnmappedDigestDispatch1775300000000 implements MigrationInterface {
  name = 'StaffTzUnmappedDigestDispatch1775300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $r$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'staff_unsorted_photos'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'staff_unmapped_reports'
        ) THEN
          ALTER TABLE "staff_unsorted_photos" RENAME TO "staff_unmapped_reports";
        END IF;
      END
      $r$;
    `);

    await queryRunner.query(`
      DO $r$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'IDX_staff_unsorted_photos_userId'
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'IDX_staff_unmapped_reports_userId'
        ) THEN
          EXECUTE 'ALTER INDEX "IDX_staff_unsorted_photos_userId" RENAME TO "IDX_staff_unmapped_reports_userId"';
        END IF;
      END
      $r$;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" ADD COLUMN IF NOT EXISTS "transcript" text
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" ALTER COLUMN "photoUrl" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" DROP CONSTRAINT IF EXISTS "CHK_staff_unmapped_reports_has_content"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" ADD CONSTRAINT "CHK_staff_unmapped_reports_has_content"
      CHECK ("transcript" IS NOT NULL OR "photoUrl" IS NOT NULL)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_telegram_pending_voice_incidents" (
        "userId" uuid NOT NULL,
        "title" text NOT NULL,
        "transcript" text NOT NULL,
        "candidatePropertyIds" jsonb NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_staff_telegram_pending_voice_incidents" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_staff_telegram_pending_voice_incidents_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_daily_digest_sent" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "digestDate" date NOT NULL,
        "timezone" character varying(128) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_daily_digest_sent" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_daily_digest_sent_user_date_tz" UNIQUE ("userId", "digestDate", "timezone"),
        CONSTRAINT "FK_staff_daily_digest_sent_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_daily_digest_sent_digestDate" ON "staff_daily_digest_sent" ("digestDate")`,
    );

    await queryRunner.query(`ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "dispatchedTaskId" uuid`);

    await queryRunner.query(`
      DO $r$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_incidents_dispatchedTask'
        ) THEN
          ALTER TABLE "incidents" ADD CONSTRAINT "FK_incidents_dispatchedTask"
          FOREIGN KEY ("dispatchedTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL;
        END IF;
      END
      $r$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "FK_incidents_dispatchedTask"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN IF EXISTS "dispatchedTaskId"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "staff_daily_digest_sent"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_telegram_pending_voice_incidents"`);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" DROP CONSTRAINT IF EXISTS "CHK_staff_unmapped_reports_has_content"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" DROP COLUMN IF EXISTS "transcript"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "staff_unmapped_reports" ALTER COLUMN "photoUrl" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $r$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'staff_unmapped_reports'
        ) THEN
          ALTER TABLE "staff_unmapped_reports" RENAME TO "staff_unsorted_photos";
        END IF;
      END
      $r$;
    `);
    await queryRunner.query(`
      DO $r$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'IDX_staff_unmapped_reports_userId'
        ) THEN
          EXECUTE 'ALTER INDEX "IDX_staff_unmapped_reports_userId" RENAME TO "IDX_staff_unsorted_photos_userId"';
        END IF;
      END
      $r$;
    `);
  }
}
