import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill inbox titles from messaging threads, chat metadata, booking aliases, and message bodies.
 * New inbound mail sets guestDisplayName on arrival; this fixes existing rows.
 */
export class BackfillConversationGuestDisplayName1777900000000 implements MigrationInterface {
  name = 'BackfillConversationGuestDisplayName1777900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "conversations" c
      SET "guestDisplayName" = s.guest_name
      FROM (
        SELECT DISTINCT ON (conversation_id) conversation_id, trim(guest_name) AS guest_name
        FROM messaging_threads
        WHERE conversation_id IS NOT NULL
          AND guest_name IS NOT NULL
          AND trim(guest_name) <> ''
        ORDER BY conversation_id, updated_at DESC NULLS LAST
      ) s
      WHERE c.id = s.conversation_id
        AND (c."guestDisplayName" IS NULL OR trim(c."guestDisplayName") = '')
    `);

    await queryRunner.query(`
      UPDATE "conversations" c
      SET "guestDisplayName" = s.guest_name
      FROM (
        SELECT DISTINCT ON ("conversationId")
          "conversationId" AS conversation_id,
          trim(coalesce(metadata->>'guestName', metadata->'bookingCom'->>'guestName')) AS guest_name
        FROM chat_messages
        WHERE "conversationId" IS NOT NULL
          AND role = 'user'
          AND metadata IS NOT NULL
          AND trim(coalesce(metadata->>'guestName', metadata->'bookingCom'->>'guestName', '')) <> ''
        ORDER BY "conversationId", "createdAt" ASC
      ) s
      WHERE c.id = s.conversation_id
        AND (c."guestDisplayName" IS NULL OR trim(c."guestDisplayName") = '')
    `);

    await queryRunner.query(`
      UPDATE "conversations" c
      SET "guestDisplayName" = s.guest_name
      FROM (
        SELECT DISTINCT ON ("conversationId")
          "conversationId" AS conversation_id,
          trim(substring(m.content from '(?i)(?:\\*Имя гостя\\*|Имя гостя|Guest name)\\s*[:\\*]?\\s*([^\\n\\r]+)')) AS guest_name
        FROM chat_messages m
        WHERE m."conversationId" IS NOT NULL
          AND m.role = 'user'
          AND m.content ~* '(Имя гостя|Guest name)'
        ORDER BY "conversationId", "createdAt" ASC
      ) s
      WHERE c.id = s.conversation_id
        AND (c."guestDisplayName" IS NULL OR trim(c."guestDisplayName") = '')
        AND s.guest_name IS NOT NULL
        AND trim(s.guest_name) <> ''
    `);

    await queryRunner.query(`
      UPDATE "conversations" c
      SET "guestDisplayName" = b."guestName"
      FROM bookings b
      WHERE (c."guestDisplayName" IS NULL OR trim(c."guestDisplayName") = '')
        AND c."externalGuestKey" LIKE 'email:%'
        AND b.guest_email_alias IS NOT NULL
        AND trim(b.guest_email_alias) <> ''
        AND trim(b."guestName") <> ''
        AND lower(trim(b.guest_email_alias)) = lower(
          CASE
            WHEN c."externalGuestKey" LIKE '%|reservation:%'
            THEN substring(c."externalGuestKey" from 7 for position('|reservation:' in c."externalGuestKey") - 7)
            ELSE substring(c."externalGuestKey" from 7)
          END
        )
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Non-destructive backfill — no rollback.
  }
}
