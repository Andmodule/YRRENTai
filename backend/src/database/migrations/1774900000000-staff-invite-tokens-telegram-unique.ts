import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffInviteTokensTelegramUnique1774900000000 implements MigrationInterface {
  name = 'StaffInviteTokensTelegramUnique1774900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_invite_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "isUsed" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_invite_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_invite_tokens_token" UNIQUE ("token"),
        CONSTRAINT "FK_staff_invite_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_invite_tokens_userId" ON "staff_invite_tokens" ("userId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "telegramChatId" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_telegramChatId" ON "users" ("telegramChatId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_telegramChatId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_invite_tokens"`);
  }
}
