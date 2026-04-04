import { MigrationInterface, QueryRunner } from 'typeorm';

export class EscalationMessagingThreadId1774600000000 implements MigrationInterface {
  name = 'EscalationMessagingThreadId1774600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "escalations"
      ADD COLUMN IF NOT EXISTS "messagingThreadId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "escalations"
      ADD CONSTRAINT "FK_escalations_messaging_thread"
      FOREIGN KEY ("messagingThreadId") REFERENCES "messaging_threads"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "escalations" DROP CONSTRAINT IF EXISTS "FK_escalations_messaging_thread"`);
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN IF EXISTS "messagingThreadId"`);
  }
}
