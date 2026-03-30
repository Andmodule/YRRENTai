import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersTelegramChatId1772246400000 implements MigrationInterface {
  name = 'AddUsersTelegramChatId1772246400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegramChatId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "telegramChatId"`,
    );
  }
}
