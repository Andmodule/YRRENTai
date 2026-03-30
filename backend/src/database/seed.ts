import { Logger } from '@nestjs/common';

const logger = new Logger('Seed');

async function runSeeds() {
  logger.log('Running database seeds...');
  logger.log('Seeds completed');
}

runSeeds().catch((err) => {
  logger.error('Seed failed', err);
  process.exit(1);
});
