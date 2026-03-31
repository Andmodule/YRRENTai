import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { startOfDay, endOfDay } from 'date-fns';
import { BOOKING_STATUS } from '@rentai/shared';
import { TaskEntity } from '../tasks/entities/task.entity';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { InventoryItemEntity } from './entities/inventory-item.entity';

export interface ManagerReportSummaryDto {
  period: { from: string; to: string };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    completed: number;
  };
  incidents: { total: number; open: number };
  bookings: {
    count: number;
    totalRevenueMinor: number;
    currency: string;
  };
  inventory: {
    lowStockCount: number;
    totalSku: number;
  };
}

@Injectable()
export class ManagerReportsService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentRepo: Repository<IncidentEntity>,
    @InjectRepository(BookingEntity)
    private readonly bookingRepo: Repository<BookingEntity>,
    @InjectRepository(InventoryItemEntity)
    private readonly inventoryRepo: Repository<InventoryItemEntity>,
  ) {}

  async getSummary(ownerId: string, fromDate: string, toDate: string): Promise<ManagerReportSummaryDto> {
    const from = fromDate.trim();
    const to = toDate.trim();

    const taskRows = await this.taskRepo
      .createQueryBuilder('t')
      .innerJoin('t.property', 'p')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to })
      .groupBy('t.status')
      .getRawMany<{ status: string; cnt: string }>();

    const byStatus: Record<string, number> = {};
    let totalTasks = 0;
    for (const r of taskRows) {
      const n = Number(r.cnt);
      byStatus[r.status] = n;
      totalTasks += n;
    }

    const completed = await this.taskRepo
      .createQueryBuilder('t')
      .innerJoin('t.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to })
      .andWhere('t.status = :st', { st: 'done' })
      .getCount();

    const incFrom = startOfDay(new Date(from + 'T12:00:00'));
    const incTo = endOfDay(new Date(to + 'T12:00:00'));

    const incidentTotal = await this.incidentRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('i.createdAt BETWEEN :df AND :dt', { df: incFrom, dt: incTo })
      .getCount();

    const incidentOpen = await this.incidentRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('i.createdAt BETWEEN :df AND :dt', { df: incFrom, dt: incTo })
      .andWhere('i.status IN (:...st)', { st: ['open', 'in_review'] })
      .getCount();

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('b.checkIn <= :toEnd', { toEnd: new Date(to + 'T23:59:59.999Z') })
      .andWhere('b.checkOut >= :fromStart', { fromStart: new Date(from + 'T00:00:00.000Z') })
      .getMany();

    const excluded = new Set<string>([
      BOOKING_STATUS.CANCELLED,
      BOOKING_STATUS.DECLINED,
      BOOKING_STATUS.NO_SHOW,
    ]);
    let totalRevenueMinor = 0;
    let currency = 'USD';
    let activeCount = 0;
    for (const b of bookings) {
      if (!excluded.has(b.status)) {
        totalRevenueMinor += b.totalPriceMinor;
        currency = b.currency || currency;
        activeCount += 1;
      }
    }

    const lowStock = await this.inventoryRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .andWhere('i.currentStock <= i.lowStockThreshold')
      .andWhere('i.lowStockThreshold > 0')
      .getCount();

    const totalSku = await this.inventoryRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .getCount();

    return {
      period: { from, to },
      tasks: {
        total: totalTasks,
        byStatus,
        completed,
      },
      incidents: { total: incidentTotal, open: incidentOpen },
      bookings: {
        count: activeCount,
        totalRevenueMinor,
        currency,
      },
      inventory: {
        lowStockCount: lowStock,
        totalSku: totalSku,
      },
    };
  }
}
