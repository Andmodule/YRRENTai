import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingThreadLastInboundSubject1773700000000 implements MigrationInterface {
  name = 'MessagingThreadLastInboundSubject1773700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messaging_threads"
      ADD COLUMN IF NOT EXISTS "last_inbound_subject" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messaging_threads" DROP COLUMN IF EXISTS "last_inbound_subject"
    `);
  }
}
