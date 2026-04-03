import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingPaymentInternalNotes1773800000000 implements MigrationInterface {
  name = 'BookingPaymentInternalNotes1773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "internalNotes" text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "paymentStatus" character varying(16) NOT NULL DEFAULT 'unpaid'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "paymentStatus"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "internalNotes"`);
  }
}
