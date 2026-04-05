import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { formatInTimeZone } from 'date-fns-tz';
import { parseISO } from 'date-fns';
import { TaskEntity } from './entities/task.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { StaffDailyDigestSentEntity } from './entities/staff-daily-digest-sent.entity';
import { UserEntity } from '../user/entities/user.entity';
import { StaffNotificationService } from '../telegram/staff-notification.service';

/**
 * Runs every 5 minutes so fractional timezones (e.g. +5:30) still hit the 08:00 local window.
 * Uses PropertyEntity.timezone and each property's local calendar date — not server UTC.
 */
@Injectable()
export class TasksDigestSchedulerService {
  private readonly logger = new Logger(TasksDigestSchedulerService.name);

  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    @InjectRepository(StaffDailyDigestSentEntity)
    private readonly digestSentRepo: Repository<StaffDailyDigestSentEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly staffNotification: StaffNotificationService,
  ) {}

  @Cron('*/5 * * * *')
  async runDigestWindow(): Promise<void> {
    const now = new Date();
    const tzRows = await this.propertyRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.timezone', 'tz')
      .where('p.timezone IS NOT NULL')
      .andWhere(`TRIM(p.timezone) <> ''`)
      .getRawMany();
    const timezones = (tzRows as { tz: string }[]).map((r) => r.tz).filter(Boolean);

    for (const tz of timezones) {
      const hour = parseInt(formatInTimeZone(now, tz, 'H'), 10);
      const minute = parseInt(formatInTimeZone(now, tz, 'm'), 10);
      if (hour !== 8 || minute > 15) continue;

      const localYmd = formatInTimeZone(now, tz, 'yyyy-MM-dd');

      const tasks = await this.taskRepo.find({
        where: {
          dueDate: localYmd,
          status: In(['pending', 'in_progress']),
        },
        relations: ['property', 'assignee'],
        order: { dueTime: 'ASC', dueDate: 'ASC' },
        take: 500,
      });

      const tasksInTz = tasks.filter((t) => t.property?.timezone === tz && t.assigneeId);
      const byStaff = new Map<string, TaskEntity[]>();
      for (const t of tasksInTz) {
        const aid = t.assigneeId!;
        if (!byStaff.has(aid)) byStaff.set(aid, []);
        byStaff.get(aid)!.push(t);
      }

      for (const [staffId, staffTasks] of byStaff) {
        const user = await this.userRepo.findOne({ where: { id: staffId } });
        if (!user || user.role !== 'STAFF' || !user.telegramChatId?.trim()) continue;

        const digestDate = parseISO(localYmd);
        try {
          await this.digestSentRepo.insert({
            userId: staffId,
            digestDate,
            timezone: tz,
          });
        } catch (e) {
          if (e instanceof QueryFailedError) {
            const code = (e as unknown as { driverError?: { code?: string } }).driverError?.code;
            if (code === '23505') continue;
          }
          this.logger.warn(`digest_sent insert: ${(e as Error).message}`);
          continue;
        }

        const lines = this.buildDigestLines(user, staffTasks);
        await this.staffNotification.sendMorningDigest(user.telegramChatId.trim(), lines);
      }
    }
  }

  private buildDigestLines(user: UserEntity, tasks: TaskEntity[]): string[] {
    const name = user.firstName?.trim() || '';
    const header = name
      ? `Доброе утро! ☀️ У тебя сегодня ${tasks.length} ${this.pluralRu(tasks.length)}:`
      : `Доброе утро! ☀️ Сегодня ${tasks.length} ${this.pluralRu(tasks.length)}:`;
    const lines = [header];
    tasks.slice(0, 20).forEach((t, i) => {
      const prop = t.property?.name ?? 'Объект';
      const due = t.dueTime ? `к ${t.dueTime}` : 'до вечера';
      lines.push(`${i + 1}. ${prop} (${this.taskTypeLabelRu(t.type)}) — ${due}`);
    });
    return lines;
  }

  private pluralRu(n: number): string {
    const m = n % 10;
    const m100 = n % 100;
    if (m100 >= 11 && m100 <= 14) return 'задач';
    if (m === 1) return 'задача';
    if (m >= 2 && m <= 4) return 'задачи';
    return 'задач';
  }

  private taskTypeLabelRu(type: string): string {
    const m: Record<string, string> = {
      checkout_cleaning: 'Выезд',
      mid_stay_cleaning: 'Промежуточная',
      checkin_prep: 'Заезд',
      maintenance: 'Техника',
      other: 'Другое',
    };
    return m[type] ?? type;
  }
}
