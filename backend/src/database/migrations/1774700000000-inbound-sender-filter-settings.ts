import { MigrationInterface, QueryRunner } from 'typeorm';

export class InboundSenderFilterSettings1774700000000 implements MigrationInterface {
  name = 'InboundSenderFilterSettings1774700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbound_sender_filter_settings" (
        "id" varchar(32) NOT NULL PRIMARY KEY,
        "allowed_hosts" jsonb NOT NULL DEFAULT '["guest.booking.com","mchat.booking.com"]'::jsonb,
        "allow_gmail_googlemail" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      INSERT INTO "inbound_sender_filter_settings" ("id", "allowed_hosts", "allow_gmail_googlemail")
      VALUES (
        'default',
        '["guest.booking.com","mchat.booking.com"]'::jsonb,
        false
      )
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inbound_sender_filter_settings"`);
  }
}
