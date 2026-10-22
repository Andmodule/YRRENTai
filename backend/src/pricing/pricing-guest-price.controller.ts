import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingGuestPriceService } from './pricing-guest-price.service';
import { ChannelProfileDto, NightPricesDto, ObservationDto } from './dto/pricing-guest-price.dto';

/**
 * «Цена для гостя» in the calendar of one property. Every route answers 503 while
 * ZODOMUS_PROMOTIONS_GUEST_PRICE_ENABLED=false. Nothing here writes to Booking or Airbnb.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing/guest-price')
export class PricingGuestPriceController {
  constructor(private readonly guestPrice: PricingGuestPriceService) {}

  /** Profiles, hand-typed channel prices for `?from=yyyy-MM-dd&to=yyyy-MM-dd` (≤ 120 days), latest calibrations. */
  @Get(':propertyId')
  async overview(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return { data: await this.guestPrice.overview(user, propertyId, from, to) };
  }

  @Put(':propertyId/profiles/:channel')
  async saveProfile(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('channel') channel: string,
    @Body() body: ChannelProfileDto,
  ) {
    return { data: await this.guestPrice.saveProfile(user, propertyId, channel, body) };
  }

  @Put(':propertyId/night-prices')
  async setNightPrices(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: NightPricesDto,
  ) {
    return { data: await this.guestPrice.setNightPrices(user, propertyId, body) };
  }

  @Post(':propertyId/observations')
  async addObservation(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: ObservationDto,
  ) {
    return { data: await this.guestPrice.addObservation(user, propertyId, body) };
  }
}
