/**
 * Тестовый аккаунт для web-приложения frontend-staff (email+пароль).
 *
 * Запуск из корня backend: pnpm seed:staff-web-test
 * Требуется в БД хотя бы один OWNER с companyId (обычный арендодатель из кабинета).
 *
 * Email: staff@staff.com
 * Пароль: staffstaff
 * Роль: STAFF, тип: cleaner, имя: And
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { UserEntity } from '../user/entities/user.entity';

const logger = new Logger('SeedStaffWebTestUser');

const TEST_EMAIL = 'staff@staff.com';
const TEST_PASSWORD = 'staffstaff';
const BCRYPT_ROUNDS = 12;

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const repo = ds.getRepository(UserEntity);

    const owner = await repo.findOne({
      where: { role: 'OWNER' },
      order: { createdAt: 'ASC' },
    });

    if (!owner?.companyId) {
      logger.error(
        'Не найден OWNER с companyId. Сначала зарегистрируйте владельца в приложении или создайте компанию.',
      );
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);
    const email = TEST_EMAIL.toLowerCase();

    let user = await repo.findOne({ where: { email } });

    if (user && user.role !== 'STAFF') {
      logger.error(`Email ${email} уже занят пользователем с ролью ${user.role}. Удалите/смените email вручную.`);
      process.exitCode = 1;
      return;
    }

    if (user) {
      user.passwordHash = passwordHash;
      user.firstName = 'And';
      user.lastName = user.lastName?.trim() ? user.lastName : 'Driver';
      user.role = 'STAFF';
      user.employerOwnerId = owner.id;
      user.companyId = owner.companyId;
      user.staffJobType = 'cleaner';
      await repo.save(user);
      logger.log(`Обновлён STAFF: ${email} → привязан к OWNER ${owner.id} (${owner.firstName} ${owner.lastName}), cleaner.`);
    } else {
      user = repo.create({
        email,
        passwordHash,
        firstName: 'And',
        lastName: 'Driver',
        role: 'STAFF',
        employerOwnerId: owner.id,
        companyId: owner.companyId,
        staffJobType: 'cleaner',
        language: 'ru',
      });
      await repo.save(user);
      logger.log(`Создан STAFF: ${email} → привязан к OWNER ${owner.id} (${owner.firstName} ${owner.lastName}), cleaner.`);
    }

    logger.log(`Пароль: ${TEST_PASSWORD} (только для dev/test).`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
