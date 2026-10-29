import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Airbnb through Zodomus: the host token of each owner (POST /airbnb-host-activation) and its last status.
 * Additive only — one new table, nothing existing is touched. `down` drops it.
 * Run it BEFORE setting ZODOMUS_AIRBNB_ENABLED=true.
 */
export class ZodomusAirbnbHosts1778900000000 implements MigrationInterface {
  name = 'ZodomusAirbnbHosts1778900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "zodomus_airbnb_hosts" (
        "ownerId" uuid NOT NULL,
        "token" varchar(255) NOT NULL,
        "clientId" varchar(255) NOT NULL,
        "statusCode" integer,
        "statusText" text,
        "checkedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_zodomus_airbnb_hosts" PRIMARY KEY ("ownerId"),
        CONSTRAINT "FK_zodomus_airbnb_hosts_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "zodomus_airbnb_hosts"`);
  }
}
