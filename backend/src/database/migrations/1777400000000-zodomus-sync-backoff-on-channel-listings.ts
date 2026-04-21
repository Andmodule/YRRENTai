import { MigrationInterface, QueryRunner } from 'typeorm';

export class ZodomusSyncBackoffOnChannelListings1777400000000 implements MigrationInterface {
  name = 'ZodomusSyncBackoffOnChannelListings1777400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings"
      ADD COLUMN IF NOT EXISTS "zodomusSyncFailCount" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings"
      ADD COLUMN IF NOT EXISTS "zodomusSyncBlockedUntil" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings"
      ADD COLUMN IF NOT EXISTS "zodomusSyncLastError" text NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings"
      ADD COLUMN IF NOT EXISTS "zodomusSyncLastErrorAt" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_property_channel_listings_zodomus_blocked_until"
      ON "property_channel_listings" ("zodomusSyncBlockedUntil")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_property_channel_listings_zodomus_blocked_until"`);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings" DROP COLUMN IF EXISTS "zodomusSyncLastErrorAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings" DROP COLUMN IF EXISTS "zodomusSyncLastError"
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings" DROP COLUMN IF EXISTS "zodomusSyncBlockedUntil"
    `);
    await queryRunner.query(`
      ALTER TABLE "property_channel_listings" DROP COLUMN IF EXISTS "zodomusSyncFailCount"
    `);
  }
}

