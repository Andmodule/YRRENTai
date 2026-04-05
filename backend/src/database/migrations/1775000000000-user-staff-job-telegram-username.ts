import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserStaffJobTelegramUsername1775000000000 implements MigrationInterface {
  name = 'UserStaffJobTelegramUsername1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staffJobType" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegramUsername" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "telegramUsername"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "staffJobType"`);
  }
}
