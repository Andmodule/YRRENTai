import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Скидка» on top of the base price (property_price_discounts). Additive only — one new table, nothing existing
 * is touched. `down` drops it. Run it BEFORE setting ZODOMUS_PROMOTIONS_DISCOUNTS_ENABLED=true.
 */
export class PricingDiscounts1779000000000 implements MigrationInterface {
  name = 'PricingDiscounts1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_price_discounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "propertyId" uuid NOT NULL,
        "dateFrom" date NOT NULL,
        "dateTo" date NOT NULL,
        "pct" smallint NOT NULL,
        "channels" jsonb NOT NULL,
        "name" varchar(80),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_property_price_discounts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_property_price_discounts_pct" CHECK ("pct" BETWEEN 1 AND 90),
        CONSTRAINT "CHK_property_price_discounts_dates" CHECK ("dateFrom" <= "dateTo"),
        CONSTRAINT "FK_property_price_discounts_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_property_price_discounts_property_dates" ON "property_price_discounts" ("propertyId", "dateFrom", "dateTo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_price_discounts"`);
  }
}
