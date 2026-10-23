import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingBasePriceService } from './pricing-base-price.service';
import { BasePriceRangeDto, BookingSendConfirmDto, BookingSendDto, ChannelPricingDto } from './dto/pricing-base-price.dto';

/**
 * «Цены → базовая цена» in the calendar of one property. Every route answers 503 while
 * ZODOMUS_PROMOTIONS_BASE_PRICE_ENABLED=false. Only `booking/send` writes to Booking, on command;
 * its progress is read with GET /calendar-dates/job.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing/base-prices')
export class PricingBasePriceController {
  constructor(private readonly basePrice: PricingBasePriceService) {}

  /** Base prices for `?from=yyyy-MM-dd&to=yyyy-MM-dd` (≤ 366 days), channel markups, whether Booking can be sent to. */
  @Get(':propertyId')
  async overview(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return { data: await this.basePrice.overview(user, propertyId, from, to) };
  }

  @Put(':propertyId')
  async setRange(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: BasePriceRangeDto,
  ) {
    return { data: await this.basePrice.setRange(user, propertyId, body) };
  }

  /** Nights of [from, to] without a base price get Booking's price — open nights only. Reads Booking. */
  @Post(':propertyId/fill-from-booking')
  async fillFromBooking(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: BookingSendDto,
  ) {
    return { data: await this.basePrice.fillFromBooking(user, propertyId, body) };
  }

  @Put(':propertyId/channels/:channel')
  async saveChannel(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('channel') channel: string,
    @Body() body: ChannelPricingDto,
  ) {
    return { data: await this.basePrice.saveChannel(user, propertyId, channel, body) };
  }

  @Post(':propertyId/booking/preview')
  async previewBooking(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: BookingSendDto,
  ) {
    return { data: await this.basePrice.previewBooking(user, propertyId, body) };
  }

  @Post(':propertyId/booking/send')
  async sendBooking(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: BookingSendConfirmDto,
  ) {
    return { data: await this.basePrice.sendBooking(user, propertyId, body) };
  }
}
