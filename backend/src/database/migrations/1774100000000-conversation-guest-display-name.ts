import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationGuestDisplayName1774100000000 implements MigrationInterface {
  name = 'ConversationGuestDisplayName1774100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "guestDisplayName" character varying(255) NULL`,
    );

    await queryRunner.query(`
      UPDATE "conversations" c
      SET "guestDisplayName" = s.guest_name
      FROM (
        SELECT DISTINCT ON (conversation_id) conversation_id, guest_name
        FROM messaging_threads
        WHERE conversation_id IS NOT NULL
          AND guest_name IS NOT NULL
          AND trim(guest_name) <> ''
        ORDER BY conversation_id, updated_at DESC NULLS LAST
      ) s
      WHERE c.id = s.conversation_id
        AND c."guestDisplayName" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "guestDisplayName"`);
  }
}
