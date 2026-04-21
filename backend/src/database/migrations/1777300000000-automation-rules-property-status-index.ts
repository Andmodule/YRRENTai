import { MigrationInterface, QueryRunner } from 'typeorm';

export class AutomationRulesPropertyStatusIndex1777300000000 implements MigrationInterface {
  name = 'AutomationRulesPropertyStatusIndex1777300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_automation_rules_property_status"
      ON "automation_rules" ("propertyId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_rules_property_status"`);
  }
}
