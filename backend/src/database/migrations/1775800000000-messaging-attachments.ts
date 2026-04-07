import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingAttachments1775800000000 implements MigrationInterface {
  name = 'MessagingAttachments1775800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messaging_attachments" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "message_id" uuid NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
        "file_name" varchar(1024) NOT NULL,
        "content_type" varchar(255) NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" varchar(2048) NOT NULL,
        "public_url" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_attachments_message" ON "messaging_attachments" ("message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "messaging_attachments"`);
  }
}
