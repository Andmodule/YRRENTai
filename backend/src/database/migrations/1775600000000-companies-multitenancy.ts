import { MigrationInterface, QueryRunner } from 'typeorm';

/** Default tenant id for existing dev/test rows (single company). */
export const DEFAULT_COMPANY_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

export class CompaniesMultitenancy1775600000000 implements MigrationInterface {
  name = 'CompaniesMultitenancy1775600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_companies" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `INSERT INTO "companies" ("id", "name", "createdAt", "updatedAt") VALUES ($1, $2, NOW(), NOW())`,
      [DEFAULT_COMPANY_ID, 'RentAI Demo'],
    );

    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "companyId" uuid`);
    await queryRunner.query(
      `UPDATE "users" SET "companyId" = $1 WHERE "role" IN ('OWNER', 'MANAGER', 'STAFF', 'GUEST')`,
      [DEFAULT_COMPANY_ID],
    );

    await queryRunner.query(`ALTER TABLE "properties" ADD COLUMN "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "properties" p
      SET "companyId" = u."companyId"
      FROM "users" u
      WHERE p."ownerId" = u.id
    `);
    await queryRunner.query(`
      UPDATE "properties" SET "companyId" = $1 WHERE "companyId" IS NULL
    `, [DEFAULT_COMPANY_ID]);

    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "tasks" t
      SET "companyId" = p."companyId"
      FROM "properties" p
      WHERE t."propertyId" = p.id
    `);

    await queryRunner.query(`ALTER TABLE "incidents" ADD COLUMN "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "incidents" i
      SET "companyId" = p."companyId"
      FROM "properties" p
      WHERE i."propertyId" = p.id
    `);

    await queryRunner.query(`ALTER TABLE "checklist_templates" ADD COLUMN "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "checklist_templates" ct
      SET "companyId" = u."companyId"
      FROM "users" u
      WHERE ct."ownerId" = u.id
    `);

    await queryRunner.query(`
      ALTER TABLE "properties" ALTER COLUMN "companyId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks" ALTER COLUMN "companyId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "incidents" ALTER COLUMN "companyId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "checklist_templates" ALTER COLUMN "companyId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "properties"
      ADD CONSTRAINT "FK_properties_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "FK_tasks_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "incidents"
      ADD CONSTRAINT "FK_incidents_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "checklist_templates"
      ADD CONSTRAINT "FK_checklist_templates_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`CREATE INDEX "IDX_users_companyId" ON "users" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_properties_companyId" ON "properties" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_tasks_companyId" ON "tasks" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_incidents_companyId" ON "incidents" ("companyId")`);
    await queryRunner.query(`CREATE INDEX "IDX_checklist_templates_companyId" ON "checklist_templates" ("companyId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_checklist_templates_companyId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_incidents_companyId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_companyId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_properties_companyId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_companyId"`);

    await queryRunner.query(
      `ALTER TABLE "checklist_templates" DROP CONSTRAINT IF EXISTS "FK_checklist_templates_company"`,
    );
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "FK_incidents_company"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_company"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "FK_properties_company"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_company"`);

    await queryRunner.query(`ALTER TABLE "checklist_templates" DROP COLUMN "companyId"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "companyId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "companyId"`);
    await queryRunner.query(`ALTER TABLE "properties" DROP COLUMN "companyId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "companyId"`);

    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
