import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChecklistsAndIncidents1773200000000 implements MigrationInterface {
  name = 'ChecklistsAndIncidents1773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "autoApplyToType" character varying(32) NULL,
        "ownerId" uuid NOT NULL,
        "propertyId" uuid NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checklist_templates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checklist_templates_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_checklist_templates_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_template_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "templateId" uuid NOT NULL,
        "text" text NOT NULL,
        "required" boolean NOT NULL DEFAULT false,
        "sortOrder" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_checklist_template_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checklist_template_items_template" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_checklist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taskId" uuid NOT NULL,
        "text" text NOT NULL,
        "required" boolean NOT NULL DEFAULT false,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "checked" boolean NOT NULL DEFAULT false,
        "checkedAt" TIMESTAMPTZ NULL,
        "checkedBy" uuid NULL,
        CONSTRAINT "PK_task_checklist_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_task_checklist_items_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_checklist_items_user" FOREIGN KEY ("checkedBy") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_task_checklist_items_taskId" ON "task_checklist_items" ("taskId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "incidents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying(32) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'open',
        "propertyId" uuid NOT NULL,
        "taskId" uuid NULL,
        "reservationId" uuid NULL,
        "reportedBy" uuid NOT NULL,
        "description" text NOT NULL,
        "photoUrls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "guestName" character varying(255) NULL,
        "itemDescription" text NULL,
        "damageLocation" character varying(500) NULL,
        "estimatedCost" numeric(12,2) NULL,
        "managerNote" text NULL,
        "resolvedBy" uuid NULL,
        "resolvedAt" TIMESTAMPTZ NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_incidents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_incidents_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_incidents_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_incidents_reported_by" FOREIGN KEY ("reportedBy") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_incidents_resolved_by" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_incidents_property_status" ON "incidents" ("propertyId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_incidents_createdAt" ON "incidents" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "incidents"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_task_checklist_items_taskId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_template_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_templates"`);
  }
}
