import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingAutoPriceService } from './pricing-autoprice.service';
import { AutoPriceSettingsDto } from './dto/pricing-autoprice.dto';

/**
 * «Цены → Автоцены». Every route answers 503 while ZODOMUS_PROMOTIONS_AUTOPRICE_ENABLED=false.
 * Nothing here writes to Booking: the rule runs by itself once a day (in «Только показывать» it only fills the journal).
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing/auto-price')
export class PricingAutoPriceController {
  constructor(private readonly auto: PricingAutoPriceService) {}

  /** The rule, what it does today to every property, the journal. */
  @Get()
  async overview(@CurrentUser() user: JwtPayload) {
    return { data: await this.auto.overview(user) };
  }

  @Put('settings')
  async saveSettings(@CurrentUser() user: JwtPayload, @Body() body: AutoPriceSettingsDto) {
    return { data: await this.auto.saveSettings(user, body) };
  }
}
