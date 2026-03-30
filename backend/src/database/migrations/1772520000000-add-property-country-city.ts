import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPropertyCountryCity1772520000000 implements MigrationInterface {
  name = 'AddPropertyCountryCity1772520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "country" character varying(100) NOT NULL DEFAULT '-'`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "city" character varying(100) NOT NULL DEFAULT '-'`,
    );
    await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "country" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "city" DROP DEFAULT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "city"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "country"`);
  }
}
