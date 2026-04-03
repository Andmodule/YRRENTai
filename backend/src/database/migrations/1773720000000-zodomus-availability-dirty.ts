import { MigrationInterface, QueryRunner } from 'typeorm';

export class ZodomusAvailabilityDirty1773720000000 implements MigrationInterface {
  name = 'ZodomusAvailabilityDirty1773720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusAvailabilityDirty" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusAvailabilityDirty"`);
  }
}
