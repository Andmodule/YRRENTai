import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, ILike } from 'typeorm';
import { format } from 'date-fns';
import { AppModule } from '../app.module';
import { UserEntity } from '../user/entities/user.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { ChecklistService } from '../tasks/checklist.service';

const logger = new Logger('SeedStaffTasks');

const SEED_MARKER = '[seed-staff-tasks]';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const userRepo = ds.getRepository(UserEntity);
    const propRepo = ds.getRepository(PropertyEntity);
    const taskRepo = ds.getRepository(TaskEntity);
    const checklistService = app.get(ChecklistService);

    const email = (process.env.STAFF_EMAIL || 'cleaner@test.com').trim().toLowerCase();
    const staff = await userRepo.findOne({ where: { email: ILike(email) } });
    if (!staff) {
      logger.error(`Пользователь «${email}» не найден. Создайте аккаунт и выставьте role = STAFF (см. doc/staff.md).`);
      process.exitCode = 1;
      return;
    }
    if (staff.role !== 'STAFF') {
      logger.error(`У «${email}» роль ${staff.role}, нужна STAFF.`);
      process.exitCode = 1;
      return;
    }

    const property =
      (await propRepo.find({ take: 1, order: { createdAt: 'ASC' } }))[0] ?? null;
    if (!property) {
      logger.error('В базе нет ни одного объекта (properties). Создайте объект в кабинете менеджера.');
      process.exitCode = 1;
      return;
    }

    const today = format(new Date(), 'yyyy-MM-dd');

    await taskRepo
      .createQueryBuilder()
      .delete()
      .from(TaskEntity)
      .where('assigneeId = :aid', { aid: staff.id })
      .andWhere('notes LIKE :marker', { marker: `%${SEED_MARKER}%` })
      .execute();

    const base = {
      propertyId: property.id,
      reservationId: null,
      assigneeId: staff.id,
      dueDate: today,
      photoUrls: [],
    };

    const rows: Partial<TaskEntity>[] = [
      {
        ...base,
        type: 'checkout_cleaning',
        status: 'pending',
        priority: 'urgent',
        contextLabel: 'Выезд 12:00 → заезд 15:00',
        dueTime: '14:00',
        notes: `Уборка после выхода гостя. ${SEED_MARKER}`,
        issueDescription: null,
        completedAt: null,
      },
      {
        ...base,
        type: 'checkin_prep',
        status: 'in_progress',
        priority: 'normal',
        contextLabel: 'Заезд гостя сегодня вечером',
        dueTime: '15:00',
        notes: `Проверить постель, полотенца, мини-бар. ${SEED_MARKER}`,
        issueDescription: null,
        completedAt: null,
      },
      {
        ...base,
        type: 'mid_stay_cleaning',
        status: 'pending',
        priority: 'normal',
        contextLabel: 'Длительное проживание',
        dueTime: '11:00',
        notes: `Плановая уборка по запросу гостя. ${SEED_MARKER}`,
        issueDescription: null,
        completedAt: null,
      },
      {
        ...base,
        type: 'manual',
        status: 'done',
        priority: 'low',
        contextLabel: null,
        dueTime: null,
        notes: `Демо: уже выполнено (можно скрыть свайпом). ${SEED_MARKER}`,
        issueDescription: null,
        completedAt: new Date(),
      },
      {
        ...base,
        type: 'checkout_cleaning',
        status: 'issue',
        priority: 'urgent',
        contextLabel: 'Срочно',
        dueTime: '16:00',
        notes: `Демо: замечание по уборке (откройте карточку). ${SEED_MARKER}`,
        issueDescription: 'Нехватило чистого комплекта полотенец в ванной.',
        completedAt: null,
      },
    ];

    for (const r of rows) {
      const saved = await taskRepo.save(taskRepo.create(r));
      await checklistService.applyAutoTemplateIfAny(saved.id);
    }

    logger.log(
      `Создано ${rows.length} задач на ${today} для ${email} (объект: «${property.name}»). Обновите /tasks в staff-приложении.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
