import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Цена для гостя»: channel profiles (fees, VAT, discounts RentAI does not import, Airbnb prices),
 * hand-typed nightly prices of a channel, and calibration observations.
 * Additive only — three new tables, nothing existing is touched. `down` drops them.
 * Run it BEFORE setting ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED=true.
 */
export class PricingGuestPrice1778600000000 implements MigrationInterface {
  name = 'PricingGuestPrice1778600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_channel_profiles" (
        "propertyId" uuid NOT NULL,
        "channel" varchar(16) NOT NULL,
        "cleaningFeeMinor" integer,
        "vatIncludedPct" smallint,
        "cityTaxPerGuestNightMinor" integer,
        "extraDiscounts" jsonb,
        "weeklyPct" smallint,
        "monthlyPct" smallint,
        "nightlyMinor" integer,
        "weekendNightlyMinor" integer,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_channel_profiles" PRIMARY KEY ("propertyId", "channel"),
        CONSTRAINT "FK_property_channel_profiles_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_channel_night_prices" (
        "propertyId" uuid NOT NULL,
        "channel" varchar(16) NOT NULL,
        "date" date NOT NULL,
        "priceMinor" integer NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_channel_night_prices" PRIMARY KEY ("propertyId", "channel", "date"),
        CONSTRAINT "FK_property_channel_night_prices_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_observations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "propertyId" uuid NOT NULL,
        "channel" varchar(16) NOT NULL,
        "checkIn" date NOT NULL,
        "nights" smallint NOT NULL,
        "guests" smallint NOT NULL,
        "scenario" varchar(16) NOT NULL,
        "observedTotalMinor" integer NOT NULL,
        "calculatedTotalMinor" integer NOT NULL,
        "input" jsonb NOT NULL,
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_observations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_price_observations_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_observations_property"
        ON "price_observations" ("propertyId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "price_observations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_channel_night_prices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_channel_profiles"`);
  }
}
