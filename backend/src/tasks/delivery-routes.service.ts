import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, Not } from 'typeorm';
import { format } from 'date-fns';
import { DeliveryRouteEntity } from './entities/delivery-route.entity';
import { DeliveryRouteStopEntity } from './entities/delivery-route-stop.entity';
import { DeliveryStopSupplyLineEntity } from './entities/delivery-stop-supply-line.entity';
import { SupplyRequestItemEntity } from './entities/supply-request-item.entity';
import { TaskEntity } from './entities/task.entity';
import { UserEntity } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { TasksGateway } from './tasks.gateway';
import { StaffNotificationService } from '../telegram/staff-notification.service';
import { SupplyCatalogService } from './supply-catalog.service';

export interface DeliveryRouteListItemDto {
  id: string;
  scheduledDate: string;
  status: string;
  driverUserId: string | null;
  driverName: string | null;
  warehouseLabel: string | null;
  stopsCount: number;
  createdAt: string;
}

export interface DeliveryRouteStopDetailDto {
  id: string;
  sortOrder: number;
  kind: string;
  propertyId: string | null;
  propertyTitle: string | null;
  propertyAddress: string | null;
  status: string;
  /** Когда остановка закрыта (склад / объект). */
  completedAt: string | null;
  lines: Array<{
    supplyRequestItemId: string;
    name: string;
    quantity: string | null;
    unit: string | null;
  }>;
}

export interface DeliveryRouteDetailDto {
  id: string;
  companyId: string;
  scheduledDate: string;
  status: string;
  driverUserId: string | null;
  driverName: string | null;
  warehouseLabel: string | null;
  driverCanReorderStops: boolean;
  /** Следующая остановка-объект, выбранная водителем (после склада). */
  driverNextStopId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pickingLines: Array<{ name: string; quantity: string; unit: string | null }>;
  stops: DeliveryRouteStopDetailDto[];
}

@Injectable()
export class DeliveryRoutesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasksGateway: TasksGateway,
    private readonly staffNotification: StaffNotificationService,
    private readonly userService: UserService,
    private readonly supplyCatalogService: SupplyCatalogService,
    @InjectRepository(DeliveryRouteEntity)
    private readonly routeRepo: Repository<DeliveryRouteEntity>,
    @InjectRepository(DeliveryRouteStopEntity)
    private readonly stopRepo: Repository<DeliveryRouteStopEntity>,
    @InjectRepository(SupplyRequestItemEntity)
    private readonly lineRepo: Repository<SupplyRequestItemEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  private defaultScheduledDate(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  async createFromPool(
    ownerId: string,
    managerCompanyId: string,
    body: {
      supplyItemIds?: string[];
      requestLineIds?: string[];
      scheduledDate?: string;
      warehouseLabel?: string | null;
    },
  ): Promise<{ routeId: string }> {
    const supplyItemIds = [...new Set((body.supplyItemIds ?? []).map((x) => x.trim()).filter(Boolean))];
    const requestLineIds = [...new Set((body.requestLineIds ?? []).map((x) => x.trim()).filter(Boolean))];
    if (!supplyItemIds.length && !requestLineIds.length) {
      throw new BadRequestException('supplyItemIds or requestLineIds required');
    }

    const scheduledDate = (body.scheduledDate?.trim() || this.defaultScheduledDate()).slice(0, 10);

    const lines = await this.loadPendingPoolLines(ownerId, supplyItemIds, requestLineIds);
    if (!lines.length) {
      throw new BadRequestException(
        'No eligible supply lines for a route (already on a route, delivered, or nothing selected)',
      );
    }

    const head = lines[0];
    const ev0 = head?.interpretationEvent;
    if (!ev0) {
      throw new BadRequestException('Invalid supply lines');
    }
    const companyId = ev0.companyId;
    if (companyId !== managerCompanyId) {
      throw new ForbiddenException('Company mismatch');
    }

    const byProperty = new Map<string, SupplyRequestItemEntity[]>();
    for (const line of lines) {
      const pid = line.interpretationEvent?.propertyId;
      if (!pid) continue;
      const arr = byProperty.get(pid) ?? [];
      arr.push(line);
      byProperty.set(pid, arr);
    }

    if (byProperty.size === 0) {
      throw new BadRequestException('No property context for selected lines');
    }

    const propertyEntries = [...byProperty.entries()].sort((a, b) => {
      const ta = a[1][0]?.interpretationEvent?.property?.name ?? '';
      const tb = b[1][0]?.interpretationEvent?.property?.name ?? '';
      return ta.localeCompare(tb, 'ru');
    });

    return this.dataSource.transaction(async (m) => {
      const route = m.create(DeliveryRouteEntity, {
        companyId,
        scheduledDate,
        status: 'draft',
        driverUserId: null,
        warehouseLabel: body.warehouseLabel?.trim() || null,
        driverCanReorderStops: true,
      });
      const savedRoute = await m.save(route);

      const whStop = m.create(DeliveryRouteStopEntity, {
        routeId: savedRoute.id,
        sortOrder: 0,
        kind: 'warehouse',
        propertyId: null,
        status: 'pending',
      });
      await m.save(whStop);

      let order = 1;
      for (const [propertyId, propLines] of propertyEntries) {
        const stop = m.create(DeliveryRouteStopEntity, {
          routeId: savedRoute.id,
          sortOrder: order++,
          kind: 'property',
          propertyId,
          status: 'pending',
        });
        const savedStop = await m.save(stop);

        for (const pl of propLines) {
          const qty = pl.quantity?.trim() ? pl.quantity : '1';
          const j = m.create(DeliveryStopSupplyLineEntity, {
            stopId: savedStop.id,
            supplyRequestItemId: pl.id,
            quantity: qty,
          });
          await m.save(j);
          pl.deliveryRouteId = savedRoute.id;
          pl.lineStatus = 'handed_to_driver';
          await m.save(pl);
        }
      }

      this.tasksGateway.emitSupplyInterpretationsChanged();
      return { routeId: savedRoute.id };
    });
  }

  private async loadPendingPoolLines(
    ownerId: string,
    supplyItemIds: string[],
    requestLineIds: string[],
  ): Promise<SupplyRequestItemEntity[]> {
    const qb = this.lineRepo
      .createQueryBuilder('sri')
      .innerJoinAndSelect('sri.interpretationEvent', 'e')
      .innerJoinAndSelect('e.property', 'p')
      .where('p.ownerId = :oid', { oid: ownerId })
      .andWhere('sri.deliveryRouteId IS NULL')
      .andWhere('sri.lineStatus IN (:...poolLs)', {
        poolLs: ['pending', 'handed_to_driver'],
      });

    if (supplyItemIds.length && requestLineIds.length) {
      qb.andWhere('(sri.supplyItemId IN (:...sids) OR sri.id IN (:...rids))', {
        sids: supplyItemIds,
        rids: requestLineIds,
      });
    } else if (supplyItemIds.length) {
      qb.andWhere('sri.supplyItemId IN (:...sids)', { sids: supplyItemIds });
    } else {
      qb.andWhere('sri.id IN (:...rids)', { rids: requestLineIds });
    }

    return qb.orderBy('e.createdAt', 'ASC').getMany();
  }

  async listForManagerRange(
    companyId: string,
    from?: string,
    to?: string,
    completion: 'all' | 'active' | 'completed' = 'all',
  ): Promise<DeliveryRouteListItemDto[]> {
    const f = from?.trim().slice(0, 10) || this.defaultScheduledDate();
    const t = to?.trim().slice(0, 10) || f;

    const qb = this.routeRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.driverUser', 'd')
      .leftJoinAndSelect('r.stops', 's')
      .where('r.companyId = :cid', { cid: companyId })
      .andWhere('r.scheduledDate BETWEEN :f AND :t', { f, t });

    if (completion === 'active') {
      qb.andWhere('r.status != :completed', { completed: 'completed' });
    } else if (completion === 'completed') {
      qb.andWhere('r.status = :completed', { completed: 'completed' });
    }

    const routes = await qb.orderBy('r.createdAt', 'DESC').getMany();

    return routes.map((r) => ({
      id: r.id,
      scheduledDate: r.scheduledDate,
      status: r.status,
      driverUserId: r.driverUserId,
      driverName: r.driverUser ? `${r.driverUser.firstName} ${r.driverUser.lastName}`.trim() : null,
      warehouseLabel: r.warehouseLabel,
      stopsCount: r.stops?.length ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getDetailForCompany(routeId: string, companyId: string): Promise<DeliveryRouteDetailDto> {
    const route = await this.routeRepo.findOne({
      where: { id: routeId, companyId },
      relations: ['driverUser', 'stops', 'stops.property', 'stops.supplyLines'],
    });
    if (!route) throw new NotFoundException('Route not found');

    const stops = [...(route.stops ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

    const allJunctionLineIds = stops.flatMap((st) =>
      st.kind === 'property' ? (st.supplyLines ?? []).map((l) => l.supplyRequestItemId) : [],
    );
    const sriRows =
      allJunctionLineIds.length > 0
        ? await this.lineRepo.find({
            where: { id: In(allJunctionLineIds) },
            relations: ['supplyItem'],
          })
        : [];
    const sriMap = new Map(sriRows.map((r) => [r.id, r]));

    const pickingMap = new Map<string, { name: string; quantity: number; unit: string | null }>();
    for (const st of stops) {
      if (st.kind !== 'property') continue;
      for (const line of st.supplyLines ?? []) {
        const sri = sriMap.get(line.supplyRequestItemId);
        if (!sri) continue;
        const name = sri.supplyItem?.name ?? sri.name;
        const key = `${name}|${sri.unit ?? ''}`;
        const q = parseFloat(String(line.quantity)) || 0;
        const prev = pickingMap.get(key);
        if (prev) prev.quantity += q;
        else pickingMap.set(key, { name, quantity: q, unit: sri.unit ?? null });
      }
    }

    const pickingLines = [...pickingMap.values()].map((v) => ({
      name: v.name,
      quantity: Number.isInteger(v.quantity) ? String(v.quantity) : String(v.quantity),
      unit: v.unit,
    }));

    const stopDtos: DeliveryRouteStopDetailDto[] = [];
    for (const st of stops) {
      const lines: DeliveryRouteStopDetailDto['lines'] = [];
      if (st.kind === 'property') {
        for (const sl of st.supplyLines ?? []) {
          const sri = sriMap.get(sl.supplyRequestItemId);
          if (!sri) continue;
          lines.push({
            supplyRequestItemId: sri.id,
            name: sri.supplyItem?.name ?? sri.name,
            quantity: sri.quantity,
            unit: sri.unit,
          });
        }
      }
      stopDtos.push({
        id: st.id,
        sortOrder: st.sortOrder,
        kind: st.kind,
        propertyId: st.propertyId,
        propertyTitle: st.property?.name ?? null,
        propertyAddress: st.property?.address ?? null,
        status: st.status,
        completedAt: st.completedAt?.toISOString() ?? null,
        lines,
      });
    }

    return {
      id: route.id,
      companyId: route.companyId,
      scheduledDate: route.scheduledDate,
      status: route.status,
      driverUserId: route.driverUserId,
      driverName: route.driverUser ? `${route.driverUser.firstName} ${route.driverUser.lastName}`.trim() : null,
      warehouseLabel: route.warehouseLabel,
      driverCanReorderStops: route.driverCanReorderStops,
      driverNextStopId: route.driverNextStopId ?? null,
      startedAt: route.startedAt?.toISOString() ?? null,
      completedAt: route.completedAt?.toISOString() ?? null,
      pickingLines,
      stops: stopDtos,
    };
  }

  async setDriverNextStop(
    companyId: string,
    routeId: string,
    userId: string,
    stopId: string,
  ): Promise<{ ok: true }> {
    const route = await this.routeRepo.findOne({
      where: { id: routeId, companyId },
      relations: ['stops'],
    });
    if (!route) throw new NotFoundException('Route not found');
    if (route.driverUserId !== userId) throw new ForbiddenException('Not assigned to this route');
    if (route.status !== 'in_progress') throw new BadRequestException('Route must be in progress');
    await this.requireWarehousePicked(route.id);

    const sid = stopId.trim();
    const stop = route.stops?.find((s) => s.id === sid);
    if (!stop || stop.routeId !== route.id) throw new NotFoundException('Stop not found');
    if (stop.kind !== 'property') throw new BadRequestException('Only property stops can be set as next');
    if (stop.status === 'done') throw new BadRequestException('Stop already completed');

    route.driverNextStopId = stop.id;
    await this.routeRepo.save(route);
    return { ok: true };
  }

  async assignDriver(
    ownerId: string,
    companyId: string,
    routeId: string,
    driverUserId: string,
    opts?: { allowReassignWhileActive?: boolean },
  ): Promise<{ ok: true }> {
    const route = await this.routeRepo.findOne({ where: { id: routeId, companyId } });
    if (!route) throw new NotFoundException('Route not found');
    if (route.status === 'completed' || route.status === 'cancelled') {
      throw new BadRequestException('Route cannot be reassigned in current status');
    }
    if (route.status === 'in_progress' && !opts?.allowReassignWhileActive) {
      throw new BadRequestException('Route cannot be reassigned in current status');
    }

    const driver = await this.userRepo.findOne({ where: { id: driverUserId.trim() } });
    if (!driver) throw new BadRequestException('Driver not found');
    if (!['STAFF', 'MANAGER'].includes(driver.role)) {
      throw new BadRequestException('User must be staff or manager');
    }

    const allowed = await this.dataSource.query<{ id: string }[]>(
      `SELECT u.id FROM users u
       WHERE u.id = $1
         AND u.role IN ('STAFF', 'MANAGER')
         AND (
           u."employerOwnerId" = $2
           OR EXISTS (
             SELECT 1 FROM tasks t
             JOIN properties p ON t."propertyId" = p.id
             WHERE t."assigneeId" = u.id AND p."ownerId" = $2
           )
         )`,
      [driverUserId, ownerId],
    );
    if (!allowed.length) {
      throw new ForbiddenException('Driver is not in your team');
    }

    const previousDriverId = route.driverUserId?.trim() || null;

    route.driverUserId = driver.id;
    if (route.status === 'draft') {
      route.status = 'assigned';
    }

    await this.routeRepo.save(route);

    if (previousDriverId && previousDriverId !== driver.id) {
      const stops = await this.stopRepo.find({
        where: { routeId: route.id, kind: 'property' },
        select: ['propertyId'],
      });
      const propertyIds = [...new Set(stops.map((s) => s.propertyId).filter((id): id is string => Boolean(id?.trim())))];
      if (propertyIds.length > 0) {
        const tasksToMove = await this.taskRepo.find({
          where: {
            assigneeId: previousDriverId,
            companyId: route.companyId,
            propertyId: In(propertyIds),
            status: Not(In(['done'])),
          },
          select: ['id', 'status'],
        });
        if (tasksToMove.length > 0) {
          await this.taskRepo.update(
            { id: In(tasksToMove.map((t) => t.id)) },
            { assigneeId: driver.id },
          );
          for (const t of tasksToMove) {
            this.tasksGateway.emitTaskUpdated({ uuid: t.id, status: t.status });
          }
        }
      }
    }

    this.tasksGateway.emitDeliveryRouteAssigned({ routeId: route.id, driverUserId: driver.id });
    void this.staffNotification.notifyDeliveryRouteAssigned(driver.id, route.id, route.scheduledDate);

    return { ok: true };
  }

  /**
   * Убрать маршрут: строки снабжения возвращаются в пул (pending), маршрут и остановки удаляются.
   * Допустимо только для черновика / назначенного маршрута без начатых остановок и без доставленных строк.
   */
  async disbandRoute(companyId: string, routeId: string): Promise<{ ok: true }> {
    const route = await this.routeRepo.findOne({ where: { id: routeId, companyId } });
    if (!route) throw new NotFoundException('Route not found');
    if (!['draft', 'assigned'].includes(route.status)) {
      throw new BadRequestException('Route can only be disbanded while draft or assigned');
    }

    const delivered = await this.lineRepo.count({
      where: { deliveryRouteId: routeId, lineStatus: 'delivered' },
    });
    if (delivered > 0) {
      throw new BadRequestException('Cannot disband: some items are already marked delivered');
    }

    const busyStops = await this.stopRepo.count({
      where: { routeId, status: Not(In(['pending'])) },
    });
    if (busyStops > 0) {
      throw new BadRequestException('Cannot disband: route already in progress');
    }

    await this.dataSource.transaction(async (m) => {
      await m.update(
        DeliveryRouteEntity,
        { id: routeId },
        { driverNextStopId: null },
      );
      await m.update(
        SupplyRequestItemEntity,
        { deliveryRouteId: routeId },
        { lineStatus: 'pending', deliveryRouteId: null },
      );
      await m.delete(DeliveryRouteEntity, { id: routeId });
    });

    this.tasksGateway.emitSupplyInterpretationsChanged();
    return { ok: true };
  }

  async reorderStops(
    companyId: string,
    routeId: string,
    orderedPropertyStopIds: string[],
    actor: { userId: string; role: string },
  ): Promise<{ ok: true }> {
    const route = await this.routeRepo.findOne({
      where: { id: routeId, companyId },
      relations: ['stops'],
    });
    if (!route) throw new NotFoundException('Route not found');

    const isManager = actor.role === 'OWNER' || actor.role === 'MANAGER';
    const isDriver =
      route.driverUserId === actor.userId &&
      ['STAFF', 'MANAGER'].includes(actor.role) &&
      route.driverCanReorderStops;

    if (!isManager && !isDriver) {
      throw new ForbiddenException('Cannot reorder stops');
    }

    const props = route.stops.filter((s) => s.kind === 'property');
    const propIds = new Set(props.map((s) => s.id));
    if (orderedPropertyStopIds.length !== props.length || orderedPropertyStopIds.some((id) => !propIds.has(id))) {
      throw new BadRequestException('Must include each property stop exactly once');
    }

    await this.dataSource.transaction(async (m) => {
      let sort = 1;
      for (const sid of orderedPropertyStopIds) {
        await m.update(DeliveryRouteStopEntity, { id: sid }, { sortOrder: sort++ });
      }
    });

    return { ok: true };
  }

  async startRoute(companyId: string, routeId: string, userId: string): Promise<{ ok: true }> {
    const route = await this.routeRepo.findOne({ where: { id: routeId, companyId } });
    if (!route) throw new NotFoundException('Route not found');
    if (route.driverUserId !== userId) throw new ForbiddenException('Not assigned to this route');
    if (route.status !== 'assigned') throw new BadRequestException('Route must be assigned before start');
    route.status = 'in_progress';
    route.startedAt = new Date();
    await this.routeRepo.save(route);
    return { ok: true };
  }

  private async requireWarehousePicked(routeId: string): Promise<void> {
    const wh = await this.stopRepo.findOne({ where: { routeId, kind: 'warehouse' } });
    if (wh && wh.status !== 'done') {
      throw new BadRequestException('Complete warehouse loading first');
    }
  }

  async arriveStop(companyId: string, stopId: string, userId: string): Promise<{ ok: true }> {
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
      relations: ['route'],
    });
    if (!stop || stop.route.companyId !== companyId) throw new NotFoundException('Stop not found');
    const route = stop.route;
    if (route.driverUserId !== userId) throw new ForbiddenException('Not your route');
    if (route.status !== 'in_progress') throw new BadRequestException('Route not in progress');

    if (stop.kind === 'warehouse') {
      return { ok: true };
    }

    await this.requireWarehousePicked(route.id);

    if (stop.kind === 'property' && stop.status === 'pending') {
      stop.status = 'arrived';
      stop.arrivedAt = new Date();
      await this.stopRepo.save(stop);
    }
    return { ok: true };
  }

  async completeStop(companyId: string, stopId: string, userId: string): Promise<{ ok: true }> {
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
      relations: ['route'],
    });
    if (!stop || stop.route.companyId !== companyId) throw new NotFoundException('Stop not found');
    const route = stop.route;
    if (route.driverUserId !== userId) throw new ForbiddenException('Not your route');
    if (route.status !== 'in_progress') throw new BadRequestException('Route not in progress');

    const now = new Date();
    if (stop.kind === 'warehouse') {
      if (stop.status !== 'pending') throw new BadRequestException('Warehouse stop already completed');
      stop.status = 'done';
      stop.completedAt = now;
      await this.stopRepo.save(stop);
    } else {
      if (stop.status === 'done') throw new BadRequestException('Stop already completed');
      await this.requireWarehousePicked(route.id);
      stop.status = 'done';
      stop.completedAt = now;
      if (!stop.arrivedAt) stop.arrivedAt = now;
      await this.stopRepo.save(stop);

      const propId = stop.propertyId;
      if (propId) {
        const driverUser = await this.userRepo.findOne({ where: { id: userId } });
        if (!driverUser) throw new NotFoundException('User not found');
        const ownerId = await this.userService.resolveTenantOwnerId(userId, driverUser.role);
        await this.supplyCatalogService.markDeliveredForRoutePropertyStop(ownerId, route.id, propId);
      }
    }

    if (route.driverNextStopId === stop.id) {
      route.driverNextStopId = null;
      await this.routeRepo.save(route);
    }

    const refreshed = await this.stopRepo.find({ where: { routeId: route.id } });
    if (refreshed.length > 0 && refreshed.every((s) => s.status === 'done')) {
      route.status = 'completed';
      route.completedAt = new Date();
      route.driverNextStopId = null;
      await this.routeRepo.save(route);
    }

    return { ok: true };
  }

  async getActiveRouteForDriver(companyId: string, userId: string): Promise<DeliveryRouteDetailDto | null> {
    const route = await this.routeRepo
      .createQueryBuilder('r')
      .where('r.companyId = :cid', { cid: companyId })
      .andWhere('r.driverUserId = :uid', { uid: userId })
      .andWhere('r.status IN (:...st)', { st: ['assigned', 'in_progress'] })
      .orderBy('r.createdAt', 'DESC')
      .getOne();

    if (!route) return null;
    return this.getDetailForCompany(route.id, companyId);
  }

  /**
   * Маршруты водителя для staff: назначен / в работе, плюс завершённые за сегодня (по scheduledDate),
   * чтобы после закрытия маршрут не «исчезал» с главной до следующего назначения.
   */
  async listAllActiveRoutesForDriver(companyId: string, userId: string): Promise<DeliveryRouteDetailDto[]> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .where('r.companyId = :cid', { cid: companyId })
      .andWhere('r.driverUserId = :uid', { uid: userId })
      .andWhere(
        '(r.status IN (:...active) OR (r.status = :done AND r.scheduledDate = :today))',
        { active: ['assigned', 'in_progress'], done: 'completed', today },
      )
      .orderBy('r.createdAt', 'DESC')
      .getMany();
    const details = await Promise.all(routes.map((r) => this.getDetailForCompany(r.id, companyId)));
    return details;
  }

  /** Водитель может отчитываться по объекту, если он на активном назначенном маршруте (без отдельной задачи уборки). */
  async isDriverPropertyOnActiveRoute(staffId: string, propertyId: string): Promise<boolean> {
    if (!propertyId?.trim()) return false;
    const n = await this.stopRepo
      .createQueryBuilder('s')
      .innerJoin('s.route', 'r')
      .where('r.driverUserId = :staffId', { staffId })
      .andWhere('r.status IN (:...st)', { st: ['assigned', 'in_progress'] })
      .andWhere('s.kind = :k', { k: 'property' })
      .andWhere('s.propertyId = :propertyId', { propertyId: propertyId.trim() })
      .getCount();
    return n > 0;
  }
}
