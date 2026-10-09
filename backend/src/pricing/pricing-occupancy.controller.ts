import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingOccupancyService } from './pricing-occupancy.service';
import { OccupancySettingsDto } from './dto/pricing-occupancy.dto';

/**
 * «Цены → Заполненность». Every route answers 503 while ZODOMUS_PROMOTIONS_OCCUPANCY_ENABLED=false.
 * Read-only towards Booking: applying a suggestion goes through POST /pricing/promotions.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing/occupancy')
export class PricingOccupancyController {
  constructor(private readonly occupancy: PricingOccupancyService) {}

  @Get()
  async overview(@CurrentUser() user: JwtPayload) {
    return { data: await this.occupancy.overview(user) };
  }

  @Patch('settings')
  async saveSettings(@CurrentUser() user: JwtPayload, @Body() body: OccupancySettingsDto) {
    return { data: await this.occupancy.saveSettings(user, body) };
  }
}
