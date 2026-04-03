import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPropertyNotificationSettings1774400000000 implements MigrationInterface {
  name = 'DropPropertyNotificationSettings1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_notification_settings"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_notification_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "propertyId" uuid NOT NULL,
        "telegramChatId" character varying,
        CONSTRAINT "PK_property_notification_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_property_notification_settings_propertyId" UNIQUE ("propertyId")
      )
    `);
  }
}
