import { Controller, Get, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TelegramDeliveryService } from '../telegram/telegram-delivery.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(forwardRef(() => TelegramDeliveryService))
    private readonly telegramDelivery: TelegramDeliveryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check() {
    const base = { status: 'ok' as const, timestamp: new Date().toISOString() };
    const telegram = await this.telegramDelivery.getQueueHealth();
    return {
      data: {
        ...base,
        telegram,
      },
    };
  }
}