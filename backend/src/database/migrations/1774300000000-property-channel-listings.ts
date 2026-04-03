import { MigrationInterface, QueryRunner } from 'typeorm';

export class PropertyChannelListings1774300000000 implements MigrationInterface {
  name = 'PropertyChannelListings1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_channel_listings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "propertyId" uuid NOT NULL,
        "otaPlatformId" uuid NOT NULL,
        "externalListingId" character varying(255) NOT NULL,
        "zodomusRoomId" character varying(64),
        "sortOrder" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_property_channel_listings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_property_channel_listings_property_ota" UNIQUE ("propertyId", "otaPlatformId"),
        CONSTRAINT "UQ_property_channel_listings_externalListingId" UNIQUE ("externalListingId"),
        CONSTRAINT "FK_property_channel_listings_property"
          FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_property_channel_listings_ota_platform"
          FOREIGN KEY ("otaPlatformId") REFERENCES "ota_platforms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_property_channel_listings_property"
      ON "property_channel_listings" ("propertyId")
    `);

    await queryRunner.query(`
      INSERT INTO "property_channel_listings" ("propertyId", "otaPlatformId", "externalListingId", "zodomusRoomId", "sortOrder")
      SELECT p."id", p."otaPlatformId", TRIM(p."zodomusPropertyId"), p."zodomusRoomId", 0
      FROM "properties" p
      WHERE p."otaPlatformId" IS NOT NULL
        AND p."zodomusPropertyId" IS NOT NULL
        AND TRIM(p."zodomusPropertyId") <> ''
        AND NOT EXISTS (
          SELECT 1 FROM "property_channel_listings" c WHERE c."propertyId" = p."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "property_channel_listings"`);
  }
}
