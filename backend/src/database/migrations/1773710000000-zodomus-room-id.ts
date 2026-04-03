import { MigrationInterface, QueryRunner } from 'typeorm';

export class ZodomusRoomId1773710000000 implements MigrationInterface {
  name = 'ZodomusRoomId1773710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "zodomusRoomId" character varying(64) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "zodomusRoomId"`);
  }
}
