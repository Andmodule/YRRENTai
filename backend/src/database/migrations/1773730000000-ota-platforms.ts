import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Идемпотентная миграция: безопасна, если таблица/колонка уже появились вручную
 * или после прерванного запуска без записи в `migrations`.
 */
export class OtaPlatforms1773730000000 implements MigrationInterface {
  name = 'OtaPlatforms1773730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ota_platforms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(32) NOT NULL,
        "zodomusChannelId" integer NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_ota_platforms" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ota_platforms_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "ota_platforms" ("code", "zodomusChannelId", "sortOrder")
      VALUES ('booking', 1, 0), ('airbnb', 3, 1)
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "properties"
      ADD COLUMN IF NOT EXISTS "otaPlatformId" uuid NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_properties_ota_platform'
        ) THEN
          ALTER TABLE "properties"
          ADD CONSTRAINT "FK_properties_ota_platform"
          FOREIGN KEY ("otaPlatformId") REFERENCES "ota_platforms"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_properties_otaPlatformId" ON "properties" ("otaPlatformId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_properties_otaPlatformId"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "FK_properties_ota_platform"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN IF EXISTS "otaPlatformId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ota_platforms"`);
  }
}
