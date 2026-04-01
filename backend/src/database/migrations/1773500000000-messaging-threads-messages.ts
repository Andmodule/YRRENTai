import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingThreadsMessages1773500000000 implements MigrationInterface {
  name = 'MessagingThreadsMessages1773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messaging_threads" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "channel" varchar(32) NOT NULL,
        "reservation_id" varchar,
        "guest_email" varchar NOT NULL,
        "guest_name" varchar,
        "reply_to" varchar NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'open',
        "zodomus_reservation_id" varchar,
        "property_id" uuid REFERENCES "properties"("id") ON DELETE SET NULL,
        "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_threads_owner" ON "messaging_threads" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_threads_channel_reservation" ON "messaging_threads" ("channel", "reservation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_threads_guest_email" ON "messaging_threads" ("guest_email")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messaging_messages" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "thread_id" uuid NOT NULL REFERENCES "messaging_threads"("id") ON DELETE CASCADE,
        "role" varchar(32) NOT NULL,
        "text" text NOT NULL,
        "raw_email_id" varchar UNIQUE,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_messages_thread" ON "messaging_messages" ("thread_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "messaging_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messaging_threads"`);
  }
}
