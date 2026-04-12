import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeliveryRouteDriverNextStop1776900000000 implements MigrationInterface {
  name = 'DeliveryRouteDriverNextStop1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_routes"
      ADD COLUMN IF NOT EXISTS "driverNextStopId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_routes"
      ADD CONSTRAINT "FK_delivery_routes_driver_next_stop"
      FOREIGN KEY ("driverNextStopId") REFERENCES "delivery_route_stops"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_routes" DROP CONSTRAINT IF EXISTS "FK_delivery_routes_driver_next_stop"`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_routes" DROP COLUMN IF EXISTS "driverNextStopId"`);
  }
}
