import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { TelegramMetricsService } from './telegram-metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: TelegramMetricsService,
  ) {}

  @Get()
  async prometheus(@Res() res: Response): Promise<void> {
    if (!this.configService.get<boolean>('METRICS_ENABLED')) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
