import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatMessageChannelDelivery1775800000000 implements MigrationInterface {
  name = 'ChatMessageChannelDelivery1775800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "chat_messages_channel_enum" AS ENUM (
          'BOOKING_API',
          'AIRBNB_API',
          'EMAIL',
          'TELEGRAM',
          'WHATSAPP'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "chat_messages_delivery_status_enum" AS ENUM ('PENDING', 'SENT', 'ERROR');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_messages"
      ADD COLUMN IF NOT EXISTS "channel" "chat_messages_channel_enum" NOT NULL DEFAULT 'BOOKING_API'
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_messages"
      ADD COLUMN IF NOT EXISTS "deliveryStatus" "chat_messages_delivery_status_enum" NOT NULL DEFAULT 'SENT'
    `);

  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "deliveryStatus"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "channel"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "chat_messages_delivery_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "chat_messages_channel_enum"`);
  }
}
