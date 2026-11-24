import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Airbnb's own «последняя минута» / «раннее бронирование», typed in by hand (property_airbnb_deals).
 * Additive only — one new table. Run it BEFORE setting ZODOMUS_PROMOTIONS_AIRBNB_DEALS_ENABLED=true.
 */
export class PricingAirbnbDeals1779100000000 implements MigrationInterface {
  name = 'PricingAirbnbDeals1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_airbnb_deals" (
        "propertyId" uuid NOT NULL,
        "lastMinutePct" smallint,
        "lastMinuteDays" smallint,
        "earlyBirdPct" smallint,
        "earlyBirdMonths" smallint,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_airbnb_deals" PRIMARY KEY ("propertyId"),
        CONSTRAINT "CHK_property_airbnb_deals_last_minute" CHECK ("lastMinutePct" IS NULL OR ("lastMinutePct" BETWEEN 1 AND 99 AND "lastMinuteDays" BETWEEN 0 AND 28)),
        CONSTRAINT "CHK_property_airbnb_deals_early_bird" CHECK ("earlyBirdPct" IS NULL OR ("earlyBirdPct" BETWEEN 1 AND 99 AND "earlyBirdMonths" BETWEEN 1 AND 36)),
        CONSTRAINT "FK_property_airbnb_deals_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_airbnb_deals"`);
  }
}
