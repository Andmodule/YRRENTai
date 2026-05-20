import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyGlobalRules1777700000000 implements MigrationInterface {
  name = 'CompanyGlobalRules1777700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "globalDescription" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "globalRules" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "globalRules"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "globalDescription"`);
  }
}
