import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingMessagesAgentText1775700000000 implements MigrationInterface {
  name = 'MessagingMessagesAgentText1775700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messaging_messages"
      ADD COLUMN IF NOT EXISTS "agent_text" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messaging_messages" DROP COLUMN IF EXISTS "agent_text"`);
  }
}
