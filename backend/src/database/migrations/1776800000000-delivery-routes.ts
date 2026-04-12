import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeliveryRoutes1776800000000 implements MigrationInterface {
  name = 'DeliveryRoutes1776800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_routes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "companyId" uuid NOT NULL,
        "scheduledDate" date NOT NULL,
        "shift" character varying(32) NULL,
        "status" character varying(32) NOT NULL DEFAULT 'draft',
        "driverUserId" uuid NULL,
        "warehouseLabel" character varying(255) NULL,
        "driverCanReorderStops" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "startedAt" TIMESTAMPTZ NULL,
        "completedAt" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_delivery_routes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_delivery_routes_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_delivery_routes_driver" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_delivery_routes_company_date" ON "delivery_routes" ("companyId", "scheduledDate")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_route_stops" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "routeId" uuid NOT NULL,
        "sortOrder" integer NOT NULL,
        "kind" character varying(32) NOT NULL,
        "propertyId" uuid NULL,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "arrivedAt" TIMESTAMPTZ NULL,
        "completedAt" TIMESTAMPTZ NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_route_stops" PRIMARY KEY ("id"),
        CONSTRAINT "FK_delivery_route_stops_route" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_delivery_route_stops_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_delivery_route_stops_route" ON "delivery_route_stops" ("routeId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_stop_supply_lines" (
        "stopId" uuid NOT NULL,
        "supplyRequestItemId" uuid NOT NULL,
        "quantity" decimal(12,2) NOT NULL,
        CONSTRAINT "PK_delivery_stop_supply_lines" PRIMARY KEY ("stopId", "supplyRequestItemId"),
        CONSTRAINT "FK_dssl_stop" FOREIGN KEY ("stopId") REFERENCES "delivery_route_stops"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dssl_supply_line" FOREIGN KEY ("supplyRequestItemId") REFERENCES "supply_request_items"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "supply_request_items"
      ADD COLUMN IF NOT EXISTS "deliveryRouteId" uuid NULL
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "supply_request_items"
        ADD CONSTRAINT "FK_supply_request_delivery_route"
        FOREIGN KEY ("deliveryRouteId") REFERENCES "delivery_routes"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supply_request_items" DROP CONSTRAINT IF EXISTS "FK_supply_request_delivery_route"`,
    );
    await queryRunner.query(`ALTER TABLE "supply_request_items" DROP COLUMN IF EXISTS "deliveryRouteId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_stop_supply_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_route_stops"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_routes"`);
  }
}
