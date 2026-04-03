import { Module, forwardRef } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { HealthController } from './health.controller';

@Module({
  imports: [forwardRef(() => TelegramModule)],
  controllers: [HealthController],
})
export class HealthModule {}