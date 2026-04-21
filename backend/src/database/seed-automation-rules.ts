import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { PropertyEntity } from '../property/entities/property.entity';
import { AutomationRuleEntity } from '../modules/automations/entities/automation-rule.entity';

const logger = new Logger('SeedAutomationRules');

const DEFAULT_PARAMS = { notifyManager: true, delayThreshold: 30 };

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get(DataSource);
    const propRepo = ds.getRepository(PropertyEntity);
    const ruleRepo = ds.getRepository(AutomationRuleEntity);

    const properties = await propRepo.find({ order: { createdAt: 'ASC' } });
    if (properties.length === 0) {
      logger.error('No properties in database. Create a property first.');
      process.exitCode = 1;
      return;
    }

    let created = 0;
    let updated = 0;

    for (const p of properties) {
      const existing = await ruleRepo.findOne({
        where: { propertyId: p.id, key: 'CLEANER_DELAYED' },
      });
      if (existing) {
        existing.status = 'active';
        existing.category = 'operations';
        existing.params = { ...DEFAULT_PARAMS, ...(existing.params ?? {}) };
        await ruleRepo.save(existing);
        updated += 1;
        logger.log(`Updated CLEANER_DELAYED for property ${p.id} (${p.name ?? 'unnamed'})`);
      } else {
        await ruleRepo.save(
          ruleRepo.create({
            propertyId: p.id,
            key: 'CLEANER_DELAYED',
            category: 'operations',
            status: 'active',
            params: { ...DEFAULT_PARAMS },
          }),
        );
        created += 1;
        logger.log(`Created CLEANER_DELAYED for property ${p.id} (${p.name ?? 'unnamed'})`);
      }
    }

    logger.log(`Done. Created: ${created}, updated (activated): ${updated}, properties: ${properties.length}`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
