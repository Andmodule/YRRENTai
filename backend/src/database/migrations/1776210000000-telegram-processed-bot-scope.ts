import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Telegram `update_id` is unique per bot; two bots can reuse the same numeric id.
 * Scope dedup by bot: `main` (client/manager bot) vs `staff` (staff bot).
 */
export class TelegramProcessedBotScope1776210000000 implements MigrationInterface {
  name = 'TelegramProcessedBotScope1776210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "telegram_processed_updates"
      ADD COLUMN IF NOT EXISTS "botScope" character varying(16) NOT NULL DEFAULT 'main'
    `);
    await queryRunner.query(`
      UPDATE "telegram_processed_updates" SET "botScope" = 'main' WHERE "botScope" IS NULL OR "botScope" = ''
    `);
    await queryRunner.query(
      `ALTER TABLE "telegram_processed_updates" DROP CONSTRAINT IF EXISTS "UQ_telegram_processed_updates_updateId"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_telegram_processed_updates_scope_updateId"
      ON "telegram_processed_updates" ("botScope", "updateId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_telegram_processed_updates_scope_updateId"`);
    await queryRunner.query(`TRUNCATE TABLE "telegram_processed_updates"`);
    await queryRunner.query(`ALTER TABLE "telegram_processed_updates" DROP COLUMN IF EXISTS "botScope"`);
    await queryRunner.query(`
      ALTER TABLE "telegram_processed_updates"
      ADD CONSTRAINT "UQ_telegram_processed_updates_updateId" UNIQUE ("updateId")
    `);
  }
}
