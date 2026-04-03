import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TelegramService } from './telegram.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Telegram Settings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Get('properties/:propertyId/escalations')
  @Roles('OWNER', 'MANAGER')
  async getEscalations(
    @Param('propertyId') propertyId: string,
    @Query('days') days = '30',
  ) {
    const daysNum = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const escalations = await this.telegramService.getResolvedEscalations(propertyId, daysNum);
    const total = escalations.length;
    return { data: { escalations, total, days: daysNum } };
  }
}
