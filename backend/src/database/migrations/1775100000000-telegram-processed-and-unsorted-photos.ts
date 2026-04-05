import { MigrationInterface, QueryRunner } from 'typeorm';

export class TelegramProcessedAndUnsortedPhotos1775100000000 implements MigrationInterface {
  name = 'TelegramProcessedAndUnsortedPhotos1775100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "telegram_processed_updates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "updateId" bigint NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_telegram_processed_updates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_telegram_processed_updates_updateId" UNIQUE ("updateId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_unsorted_photos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "photoUrl" character varying(2048) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_unsorted_photos" PRIMARY KEY ("id"),
        CONSTRAINT "FK_staff_unsorted_photos_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_unsorted_photos_userId" ON "staff_unsorted_photos" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_telegram_pending_attachments" (
        "userId" uuid NOT NULL,
        "fileId" text NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_staff_telegram_pending_attachments" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_staff_telegram_pending_attachments_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_telegram_pending_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_unsorted_photos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_processed_updates"`);
  }
}
