import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingGuestBreakdown1773740000000 implements MigrationInterface {
  name = 'BookingGuestBreakdown1773740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestsAdults" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestsChildren" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "guestsChildren"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "guestsAdults"`);
  }
}
