import { MigrationInterface, QueryRunner } from 'typeorm';

export class InboundEmailDedupBookingAlias1774500000000 implements MigrationInterface {
  name = 'InboundEmailDedupBookingAlias1774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbound_email_dedup" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "provider" varchar(32) NOT NULL,
        "external_id" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_inbound_email_dedup_provider_external" UNIQUE ("provider", "external_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_inbound_email_dedup_created" ON "inbound_email_dedup" ("created_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "guest_email_alias" varchar(255) NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_bookings_guest_email_alias" ON "bookings" ("guest_email_alias") WHERE "guest_email_alias" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_bookings_guest_email_alias"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "guest_email_alias"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inbound_email_dedup"`);
  }
}
