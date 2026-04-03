import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatMessageMetadata1774000000000 implements MigrationInterface {
  name = 'ChatMessageMetadata1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "metadata"`);
  }
}
