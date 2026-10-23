import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Цены → базовая цена»: the property's own nightly price and how each channel's price is made from it.
 * Additive only — two new tables, nothing existing is touched. `down` drops them.
 * Run it BEFORE setting ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED=true.
 */
export class PricingBasePrice1778700000000 implements MigrationInterface {
  name = 'PricingBasePrice1778700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_base_prices" (
        "propertyId" uuid NOT NULL,
        "date" date NOT NULL,
        "priceMinor" integer NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_base_prices" PRIMARY KEY ("propertyId", "date"),
        CONSTRAINT "FK_property_base_prices_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_channel_pricing" (
        "propertyId" uuid NOT NULL,
        "channel" varchar(16) NOT NULL,
        "markupPct" smallint NOT NULL DEFAULT 0,
        "singleGuestPct" smallint,
        "extraGuestPct" smallint,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_channel_pricing" PRIMARY KEY ("propertyId", "channel"),
        CONSTRAINT "FK_property_channel_pricing_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_channel_pricing"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "property_base_prices"`);
  }
}
