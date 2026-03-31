import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In, ILike } from 'typeorm';
import { AppModule } from '../app.module';
import { PropertyEntity } from '../property/entities/property.entity';
import { BookingEntity } from '../booking/entities/booking.entity';
import { UserEntity } from '../user/entities/user.entity';
import { ARBAT_PROPERTY_NAMES } from './kb-arbat-entries';

const logger = new Logger('SeedTestBooking');

const SEED_NOTE = 'Тестовое бронирование (seed-test-booking)';

/** Все объекты с «Арбат» в названии (в т.ч. «Апартаменты» и «Апаратаменты») — отдельные UUID в БД. */
async function findArbatProperties(ds: DataSource): Promise<PropertyEntity[]> {
  const repo = ds.getRepository(PropertyEntity);

  const exact = await repo.find({
    where: { name: In([...ARBAT_PROPERTY_NAMES]) },
  });

  const fuzzy = await repo
    .createQueryBuilder('p')
    .where('p.name ILIKE :a OR p.name ILIKE :b', {
      a: '%Арбат%',
      b: '%Arbat%',
    })
    .getMany();

  const byId = new Map<string, PropertyEntity>();
  for (const p of [...exact, ...fuzzy]) {
    byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Все объекты владельца по email (для локального просмотра броней тем же пользователем в UI). */
async function findPropertiesByOwnerEmail(
  ds: DataSource,
  email: string,
): Promise<PropertyEntity[]> {
  const userRepo = ds.getRepository(UserEntity);
  const propRepo = ds.getRepository(PropertyEntity);
  const normalized = email.trim().toLowerCase();
  const user = await userRepo.findOne({ where: { email: ILike(normalized) } });
  if (!user) {
    logger.error(`Пользователь с email «${normalized}» не найден.`);
    return [];
  }
  return propRepo.find({ where: { ownerId: user.id } });
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const bookingRepo = ds.getRepository(BookingEntity);

    const email = process.env.SEED_USER_EMAIL?.trim();
    const properties = email?.length
      ? await findPropertiesByOwnerEmail(ds, email)
      : await findArbatProperties(ds);

    if (properties.length === 0) {
      logger.error(
        email?.length
          ? `Нет объектов у пользователя ${email} или пользователь не найден. Укажите SEED_USER_EMAIL или создайте объект с «Арбат» в названии (без SEED_USER_EMAIL).`
          : 'Объект не найден. Создайте объект с «Арбат» в названии или задайте SEED_USER_EMAIL=ваш@email и запустите снова.',
      );
      process.exitCode = 1;
      return;
    }

    if (email?.length) {
      logger.log(`Режим SEED_USER_EMAIL: объекты владельца ${email} — ${properties.length} шт.`);
    }

    const checkIn = new Date();
    checkIn.setDate(checkIn.getDate() + 7);
    checkIn.setHours(14, 0, 0, 0);

    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 3);
    checkOut.setHours(12, 0, 0, 0);

    let created = 0;
    for (const property of properties) {
      const existing = await bookingRepo.findOne({
        where: { propertyId: property.id, notes: SEED_NOTE },
      });
      if (existing) {
        logger.log(`Пропуск «${property.name}»: уже есть тестовое бронирование (${existing.id})`);
        continue;
      }

      const row = bookingRepo.create({
        propertyId: property.id,
        guestName: 'Тестовый гость',
        guestEmail: 'guest.test@example.com',
        guestPhone: '+7 900 000-00-01',
        checkIn,
        checkOut,
        totalPriceMinor: 45_900,
        currency: property.currency,
        guestsCount: 2,
        notes: SEED_NOTE,
        status: 'CONFIRMED',
        createdBy: property.ownerId,
      });

      const saved = await bookingRepo.save(row);
      created += 1;
      logger.log(`Создано: «${property.name}» → id=${saved.id}`);
    }

    logger.log(
      `Готово: добавлено ${created} из ${properties.length} объект(ов). ${checkIn.toISOString()} → ${checkOut.toISOString()}`,
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
