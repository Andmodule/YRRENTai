import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingOtaPaymentHint1777100000000 implements MigrationInterface {
  name = 'BookingOtaPaymentHint1777100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "otaPaymentHint" character varying(512) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "otaPaymentHint"`);
  }
}
