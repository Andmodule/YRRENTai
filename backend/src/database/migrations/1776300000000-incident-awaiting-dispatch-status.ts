import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff-reported incidents were `open` (“В работе”) before dispatch; align with
 * awaiting_dispatch for rows that were never linked to a dispatched task.
 */
export class IncidentAwaitingDispatchStatus1776300000000 implements MigrationInterface {
  name = 'IncidentAwaitingDispatchStatus1776300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "incidents" i
      SET "status" = 'awaiting_dispatch'
      FROM "users" u
      WHERE i."status" = 'open'
        AND i."dispatchedTaskId" IS NULL
        AND i."reportedBy" = u."id"
        AND u."role" = 'STAFF'
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    /* No safe revert: new rows may legitimately be awaiting_dispatch. */
  }
}
