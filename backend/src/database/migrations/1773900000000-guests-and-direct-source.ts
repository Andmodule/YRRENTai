import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuestsAndDirectSource1773900000000 implements MigrationInterface {
  name = 'GuestsAndDirectSource1773900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerId" uuid NOT NULL,
        "displayName" character varying(255) NOT NULL,
        "phoneNormalized" character varying(32) NULL,
        "emailNormalized" character varying(255) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guests_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guests_owner_phone" ON "guests" ("ownerId", "phoneNormalized") WHERE "phoneNormalized" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guests_owner_email" ON "guests" ("ownerId", "emailNormalized") WHERE "emailNormalized" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_guests_ownerId" ON "guests" ("ownerId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestId" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD CONSTRAINT "FK_bookings_guest" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "directSource" character varying(32) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "directSource"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "FK_bookings_guest"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "guestId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guests_ownerId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_guests_owner_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_guests_owner_phone"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guests"`);
  }
}
