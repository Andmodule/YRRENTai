import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffInterpretationEvents1776400000000 implements MigrationInterface {
  name = 'StaffInterpretationEvents1776400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_interpretation_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "authorId" uuid NOT NULL,
        "entryPoint" character varying(32) NOT NULL,
        "targetType" character varying(16) NOT NULL,
        "targetId" uuid NOT NULL,
        "propertyId" uuid NOT NULL,
        "companyId" uuid NOT NULL,
        "textRaw" text NOT NULL,
        "llmStatus" character varying(16) NOT NULL DEFAULT 'pending',
        "llmPayload" jsonb NULL,
        "llmError" text NULL,
        "workflowState" character varying(32) NOT NULL DEFAULT 'pending_llm',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "processedAt" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_staff_interpretation_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_staff_interp_author" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_interp_property" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_interp_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_interp_author_created" ON "staff_interpretation_events" ("authorId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_interp_property_created" ON "staff_interpretation_events" ("propertyId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_interp_company_created" ON "staff_interpretation_events" ("companyId", "createdAt" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "supply_request_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "interpretationEventId" uuid NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "name" character varying(500) NOT NULL,
        "quantity" numeric(12,2) NULL,
        "unit" character varying(32) NULL,
        "trafficLight" character varying(16) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supply_request_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supply_items_event" FOREIGN KEY ("interpretationEventId") REFERENCES "staff_interpretation_events"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_supply_items_event" ON "supply_request_items" ("interpretationEventId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "supply_request_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_interpretation_events"`);
  }
}
