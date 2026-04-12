/**
 * Аккаунт для входа в frontend-staff (email + пароль).
 *
 * Запуск из корня backend: pnpm seed:drive-user
 *
 * Email: drive@drive.com
 * Пароль: drivedrive
 * Роль: STAFF, тип: driver
 *
 * Привязка к владельцу: переменная DRIVE_USER_EMPLOYER_ID (UUID пользователя-OWNER),
 * иначе по умолчанию ниже; если такого OWNER нет — первый OWNER в БД.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { UserEntity } from '../user/entities/user.entity';

const logger = new Logger('SeedDriveUser');

const EMAIL = 'drive@drive.com';
/** Как вводят в форме входа (раньше в скрипте была опечатка drivedirve). */
const PASSWORD = 'drivedrive';
const BCRYPT_ROUNDS = 12;

const DEFAULT_EMPLOYER_OWNER_ID = '4e59fe88-72d6-41e8-9a7f-a1a8d2b5ea20';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const repo = ds.getRepository(UserEntity);

    const preferredId = (process.env.DRIVE_USER_EMPLOYER_ID ?? DEFAULT_EMPLOYER_OWNER_ID).trim();

    let owner = await repo.findOne({ where: { id: preferredId } });
    if (!owner || owner.role !== 'OWNER' || !owner.companyId) {
      logger.warn(
        `OWNER ${preferredId} не найден или без companyId — пробуем первого OWNER в БД.`,
      );
      owner = await repo.findOne({
        where: { role: 'OWNER' },
        order: { createdAt: 'ASC' },
      });
    }

    if (!owner?.companyId) {
      logger.error(
        'Не найден OWNER с companyId. Сначала зарегистрируйте владельца в приложении.',
      );
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
    const email = EMAIL.toLowerCase();

    let user = await repo.findOne({ where: { email } });

    if (user && user.role !== 'STAFF') {
      logger.error(`Email ${email} уже занят пользователем с ролью ${user.role}.`);
      process.exitCode = 1;
      return;
    }

    if (user) {
      await repo.update(
        { id: user.id },
        {
          passwordHash,
          firstName: 'Миша',
          lastName: 'Рудевой',
          role: 'STAFF',
          employerOwnerId: owner.id,
          companyId: owner.companyId,
          staffJobType: 'driver',
        },
      );
      logger.log(`Обновлён STAFF: ${email} (driver), OWNER ${owner.id}, companyId=${owner.companyId}.`);
    } else {
      user = repo.create({
        email,
        passwordHash,
        firstName: 'Миша',
        lastName: 'Рудевой',
        role: 'STAFF',
        employerOwnerId: owner.id,
        companyId: owner.companyId,
        staffJobType: 'driver',
        language: 'ru',
      });
      await repo.save(user);
      logger.log(`Создан STAFF: ${email} (driver), OWNER ${owner.id}.`);
    }

    logger.log(`Пароль задан (только для dev/test).`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
