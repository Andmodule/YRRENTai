import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { AirbnbCalendarService } from './airbnb-calendar.service';

class AirbnbFingerprintDto extends createZodDto(z.object({ fingerprint: z.string().min(1).max(64) }).strict()) {}

/**
 * The pilot Airbnb listing of a property (owner only). 503 while ZODOMUS_AIRBNB_ENABLED=false.
 * «Проверить» reads Booking and writes nothing; «Подключить» / «Отправить» write to Airbnb only what was checked.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER')
@Controller('zodomus/airbnb/listing')
export class AirbnbCalendarController {
  constructor(private readonly airbnb: AirbnbCalendarService) {}

  @Get(':propertyId')
  async view(@CurrentUser() user: JwtPayload, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return { data: await this.airbnb.view(user, propertyId) };
  }

  @Post(':propertyId/check')
  @HttpCode(200)
  async check(@CurrentUser() user: JwtPayload, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return { data: await this.airbnb.startCheck(user, propertyId) };
  }

  @Post(':propertyId/connect')
  @HttpCode(200)
  async connect(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: AirbnbFingerprintDto,
  ) {
    return { data: await this.airbnb.startConnect(user, propertyId, body.fingerprint) };
  }

  @Post(':propertyId/send')
  @HttpCode(200)
  async send(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: AirbnbFingerprintDto,
  ) {
    return { data: await this.airbnb.startSend(user, propertyId, body.fingerprint) };
  }
}
