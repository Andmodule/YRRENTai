import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Автопродление календаря»: per-property settings for keeping the next N days open on Booking.
 * Additive only — one new table, nothing existing is touched. `down` drops it.
 * Run it BEFORE setting ZODOMUS_CALENDAR_AUTO_OPEN_ENABLED=true — best together with
 * ZODOMUS_CALENDAR_DATES_ENABLED, so nights closed by hand are remembered from the start.
 */
export class CalendarAutoOpenSettings1778500000000 implements MigrationInterface {
  name = 'CalendarAutoOpenSettings1778500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_auto_open_settings" (
        "propertyId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "horizonDays" smallint NOT NULL,
        "priceMinor" integer,
        "weekendPriceMinor" integer,
        "openedUntil" character varying(10),
        "keepClosed" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "lastRunAt" TIMESTAMP WITH TIME ZONE,
        "lastResult" jsonb,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_calendar_auto_open_settings" PRIMARY KEY ("propertyId"),
        CONSTRAINT "FK_calendar_auto_open_settings_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_auto_open_settings"`);
  }
}
