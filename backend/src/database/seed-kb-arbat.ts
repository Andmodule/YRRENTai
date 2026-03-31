import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../app.module';
import { PropertyEntity } from '../property/entities/property.entity';
import { KnowledgeBaseEntryEntity } from '../knowledge-base/entities/knowledge-base-entry.entity';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { ARBAT_PROPERTY_NAMES, KB_ARBAT_ENTRIES } from './kb-arbat-entries';

const logger = new Logger('SeedKbArbat');

async function findArbatProperty(ds: DataSource): Promise<PropertyEntity | null> {
  const repo = ds.getRepository(PropertyEntity);
  const byExact = await repo.findOne({
    where: { name: In([...ARBAT_PROPERTY_NAMES]) },
  });
  if (byExact) {
    return byExact;
  }

  return repo
    .createQueryBuilder('p')
    .where('p.name ILIKE :a OR p.name ILIKE :b', {
      a: '%Арбат%',
      b: '%Arbat%',
    })
    .getOne();
}

async function run() {
  const force = process.argv.includes('--force');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const kbService = app.get(KnowledgeBaseService);
    const kbRepo = ds.getRepository(KnowledgeBaseEntryEntity);

    const property = await findArbatProperty(ds);
    if (!property) {
      logger.error(
        'Объект не найден. Создайте в интерфейсе объект с названием «Апартаменты на Арбате» (или с «Арбат» в названии), затем запустите сид снова.',
      );
      process.exitCode = 1;
      return;
    }

    logger.log(`Объект: «${property.name}» (${property.id})`);

    const existing = await kbRepo.count({ where: { propertyId: property.id } });
    if (existing > 0 && !force) {
      logger.warn(
        `Уже есть ${existing} записей БЗ. Повторная вставка пропущена. Запустите с --force чтобы удалить все записи БЗ этого объекта и заполнить заново.`,
      );
      return;
    }

    if (existing > 0 && force) {
      await kbRepo.delete({ propertyId: property.id });
      logger.log(`Удалено ${existing} старых записей (--force).`);
    }

    for (const row of KB_ARBAT_ENTRIES) {
      await kbService.create(property.id, {
        title: row.title,
        content: row.content,
        category: row.category,
      });
    }

    logger.log(`Добавлено карточек: ${KB_ARBAT_ENTRIES.length}. Эмбеддинги поставятся в очередь, если задан OPENAI_API_KEY.`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
