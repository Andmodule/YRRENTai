import { MigrationInterface, QueryRunner } from 'typeorm';

export class WhatsappPropertyAndProcessed1775900000000 implements MigrationInterface {
  name = 'WhatsappPropertyAndProcessed1775900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "properties"
      ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" character varying(64) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "properties"
      ADD COLUMN IF NOT EXISTS "whatsappAccessToken" text NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_properties_whatsappPhoneNumberId"
      ON "properties" ("whatsappPhoneNumberId")
      WHERE "whatsappPhoneNumberId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_processed_messages" (
        "wamid" character varying(128) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_whatsapp_processed_messages" PRIMARY KEY ("wamid")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_processed_messages"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_properties_whatsappPhoneNumberId"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "whatsappAccessToken"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "whatsappPhoneNumberId"`);
  }
}
