import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Цены → Скидки»: Booking promotions via Zodomus.
 * Additive only — four new tables, no changes to existing tables or data. `down` drops them.
 */
export class PricingPromotions1778300000000 implements MigrationInterface {
  name = 'PricingPromotions1778300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_promotions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerId" uuid NOT NULL,
        "companyId" uuid,
        "name" character varying(255) NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'rentai',
        "promotionType" character varying(32) NOT NULL DEFAULT 'basic',
        "discountPct" smallint NOT NULL,
        "stayFrom" date,
        "stayTo" date,
        "activeWeekdays" jsonb,
        "protectMinPrice" boolean NOT NULL DEFAULT true,
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "externalMeta" jsonb,
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_promotions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_promotions_owner"
      ON "price_promotions" ("ownerId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_promotion_targets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "promotionId" uuid NOT NULL,
        "propertyId" uuid NOT NULL,
        "channelId" integer NOT NULL,
        "externalPropertyId" character varying(255) NOT NULL,
        "desiredState" character varying(8) NOT NULL DEFAULT 'on',
        "state" character varying(16) NOT NULL DEFAULT 'pending',
        "needsPush" boolean NOT NULL DEFAULT true,
        "externalPromotionId" character varying(64),
        "previousExternalIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "pushedHash" character varying(128),
        "version" integer NOT NULL DEFAULT 1,
        "roomIds" jsonb,
        "rateIds" jsonb,
        "lastErrorCode" character varying(64),
        "lastError" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "nextAttemptAt" TIMESTAMP WITH TIME ZONE,
        "verifiedAt" TIMESTAMP WITH TIME ZONE,
        "verifyNote" text,
        "stats" jsonb,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_promotion_targets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_price_promotion_targets_promotion" FOREIGN KEY ("promotionId") REFERENCES "price_promotions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_price_promotion_targets_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_price_promotion_targets_promotion_property" UNIQUE ("promotionId", "propertyId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_promotion_targets_queue"
      ON "price_promotion_targets" ("needsPush", "nextAttemptAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_promotion_targets_property"
      ON "price_promotion_targets" ("propertyId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_promotion_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "promotionId" uuid NOT NULL,
        "propertyId" uuid,
        "actorUserId" uuid,
        "actorLabel" character varying(255) NOT NULL,
        "action" character varying(48) NOT NULL,
        "message" text NOT NULL,
        "details" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_promotion_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_price_promotion_events_promotion" FOREIGN KEY ("promotionId") REFERENCES "price_promotions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_promotion_events_promotion"
      ON "price_promotion_events" ("promotionId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_pricing_settings" (
        "propertyId" uuid NOT NULL,
        "minPriceMinor" integer,
        "geniusPct" smallint,
        "promotionsAccess" character varying(16),
        "promotionsAccessCode" character varying(64),
        "promotionsAccessDetail" text,
        "promotionsAccessCheckedAt" TIMESTAMP WITH TIME ZONE,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_pricing_settings" PRIMARY KEY ("propertyId"),
        CONSTRAINT "FK_property_pricing_settings_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "price_promotion_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_promotion_targets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "price_promotions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_pricing_settings"`);
  }
}
