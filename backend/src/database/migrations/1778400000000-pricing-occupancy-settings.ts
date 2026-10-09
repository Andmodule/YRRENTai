import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Цены → Заполненность»: per-tenant thresholds for discount suggestions.
 * Additive only — one new table, nothing existing is touched. `down` drops it.
 * Run it BEFORE setting ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED=true.
 */
export class PricingOccupancySettings1778400000000 implements MigrationInterface {
  name = 'PricingOccupancySettings1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pricing_occupancy_settings" (
        "ownerId" uuid NOT NULL,
        "horizonDays" smallint NOT NULL,
        "tiers" jsonb NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pricing_occupancy_settings" PRIMARY KEY ("ownerId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pricing_occupancy_settings"`);
  }
}
