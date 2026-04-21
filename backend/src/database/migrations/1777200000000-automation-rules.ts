import { MigrationInterface, QueryRunner } from 'typeorm';

export class AutomationRules1777200000000 implements MigrationInterface {
  name = 'AutomationRules1777200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "propertyId" uuid NOT NULL,
        "key" character varying(128) NOT NULL,
        "category" character varying(32) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'inactive',
        "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_rules_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_automation_rules_property_key" UNIQUE ("propertyId", "key")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_rules_property_category"
      ON "automation_rules" ("propertyId", "category")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_rules"`);
  }
}
