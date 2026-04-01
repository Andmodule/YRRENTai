import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingThreadConversation1773600000000 implements MigrationInterface {
  name = 'MessagingThreadConversation1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messaging_threads"
      ADD COLUMN IF NOT EXISTS "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_messaging_threads_conversation" ON "messaging_threads" ("conversation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messaging_threads_conversation"`);
    await queryRunner.query(`ALTER TABLE "messaging_threads" DROP COLUMN IF EXISTS "conversation_id"`);
  }
}
