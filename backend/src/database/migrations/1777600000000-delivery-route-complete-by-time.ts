import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeliveryRouteCompleteByTime1777600000000 implements MigrationInterface {
  name = 'DeliveryRouteCompleteByTime1777600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_routes" ADD COLUMN IF NOT EXISTS "completeByTime" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes" DROP COLUMN IF EXISTS "completeByTime"`);
  }
}
