import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncidentTelegramMessageId1773300000000 implements MigrationInterface {
  name = 'IncidentTelegramMessageId1773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "telegramNotifyMessageId" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN IF EXISTS "telegramNotifyMessageId"`);
  }
}
