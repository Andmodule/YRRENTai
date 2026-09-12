import { MigrationInterface, QueryRunner } from 'typeorm';

export class PropertyZodomusStatus1778200000000 implements MigrationInterface {
  name = 'PropertyZodomusStatus1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusStatus" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusStatusDetail" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusStatusCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusStatusCheckedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusStatusDetail"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusStatus"`);
  }
}
