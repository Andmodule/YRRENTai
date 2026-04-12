import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Исторические данные: остановка уже «done», а часть строк осталась handed_to_driver/pending.
 * Приводим в соответствие правилу «закрыл объект — всё по объекту на маршруте доставлено».
 */
export class RepairSupplyDeliveredOnDoneStops1777000000000 implements MigrationInterface {
  name = 'RepairSupplyDeliveredOnDoneStops1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE supply_request_items sri
      SET "lineStatus" = 'delivered'
      FROM staff_interpretation_events e,
           delivery_route_stops st
      WHERE sri."interpretationEventId" = e.id
        AND st."propertyId" = e."propertyId"
        AND st.kind = 'property'
        AND st.status = 'done'
        AND sri."deliveryRouteId" = st."routeId"
        AND sri."lineStatus" IN ('pending', 'handed_to_driver')
    `);
  }

  public async down(): Promise<void> {
    /* необратимо: статусы доставки не восстанавливаем */
  }
}
