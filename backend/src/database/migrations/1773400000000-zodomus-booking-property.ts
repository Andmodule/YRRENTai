import { MigrationInterface, QueryRunner } from 'typeorm';

export class ZodomusBookingProperty1773400000000 implements MigrationInterface {
  name = 'ZodomusBookingProperty1773400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusPropertyId" character varying(255) NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_properties_zodomusPropertyId" ON "properties" ("zodomusPropertyId") WHERE "zodomusPropertyId" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "zodomusReservationId" character varying(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "zodomusChannelId" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "zodomusSynced" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bookings_zodomusReservationId" ON "bookings" ("zodomusReservationId") WHERE "zodomusReservationId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_bookings_zodomusReservationId"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "zodomusSynced"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "zodomusChannelId"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "zodomusReservationId"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_properties_zodomusPropertyId"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusPropertyId"`);
  }
}
