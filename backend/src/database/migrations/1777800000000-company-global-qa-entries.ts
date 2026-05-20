import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyGlobalQaEntries1777800000000 implements MigrationInterface {
  name = 'CompanyGlobalQaEntries1777800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "globalQaEntries" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "globalQaEntries"`);
  }
}
