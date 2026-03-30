import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversations1772332800000 implements MigrationInterface {
  name = 'AddConversations1772332800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id"                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "propertyId"          uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
        "channel"             varchar(30) NOT NULL DEFAULT 'web_app',
        "status"              varchar(30) NOT NULL DEFAULT 'ai_handling',
        "externalGuestKey"    varchar,
        "lastMessagePreview"  text,
        "lastActivityAt"      timestamptz NOT NULL DEFAULT NOW(),
        "createdAt"           timestamptz NOT NULL DEFAULT NOW(),
        "updatedAt"           timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_conv_property_status" ON "conversations" ("propertyId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_conv_lastActivity" ON "conversations" ("lastActivityAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "conversationId" uuid REFERENCES "conversations"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_msg_conversation" ON "chat_messages" ("conversationId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "escalations" ADD COLUMN IF NOT EXISTS "conversationId" uuid`,
    );

    await queryRunner.query(`
      INSERT INTO "conversations" ("propertyId", "channel", "status", "lastActivityAt", "createdAt")
      SELECT
        sub."propertyId",
        'web_app',
        'ai_handling',
        sub."lastActivityAt",
        sub."createdAt"
      FROM (
        SELECT
          m."propertyId",
          MAX(m."createdAt") AS "lastActivityAt",
          MIN(m."createdAt") AS "createdAt"
        FROM "chat_messages" m
        GROUP BY m."propertyId"
      ) sub
      WHERE NOT EXISTS (
        SELECT 1 FROM "conversations" c WHERE c."propertyId" = sub."propertyId"
      )
    `);

    await queryRunner.query(`
      UPDATE "chat_messages" AS m
      SET "conversationId" = c."id"
      FROM "conversations" AS c
      WHERE c."propertyId" = m."propertyId"
        AND m."conversationId" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "conversations" AS c
      SET "lastMessagePreview" = sub."content"
      FROM (
        SELECT DISTINCT ON (m."conversationId") m."conversationId", m."content"
        FROM "chat_messages" m
        WHERE m."conversationId" IS NOT NULL
        ORDER BY m."conversationId", m."createdAt" DESC
      ) sub
      WHERE c."id" = sub."conversationId"
    `);

    await queryRunner.query(`
      UPDATE "escalations" AS e
      SET "conversationId" = c."id"
      FROM "conversations" AS c
      WHERE c."propertyId" = e."propertyId"
        AND e."conversationId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN IF EXISTS "conversationId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_msg_conversation"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "conversationId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conv_lastActivity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conv_property_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
  }
}
