import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../../common/decorators/current-user.decorator';
import { AirbnbConnectService } from './airbnb-connect.service';

/**
 * Airbnb host connection (owner only). Everything but `status` answers 503 while ZODOMUS_AIRBNB_ENABLED=false.
 * Nothing here writes to an Airbnb listing.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER')
@Controller('zodomus/airbnb')
export class AirbnbConnectController {
  constructor(private readonly airbnb: AirbnbConnectService) {}

  /** Stored host state and the authorization page — no call to Zodomus. */
  @Get('status')
  async status(@CurrentUser() user: JwtPayload) {
    return { data: await this.airbnb.status(user) };
  }

  /** POST /airbnb-host-activation → token + the page where the host allows access on airbnb.com. */
  @Post('host/activate')
  @HttpCode(200)
  async activate(@CurrentUser() user: JwtPayload) {
    return { data: await this.airbnb.activate(user) };
  }

  /** GET /airbnb-host-status for the stored token. */
  @Post('host/refresh')
  @HttpCode(200)
  async refresh(@CurrentUser() user: JwtPayload) {
    return { data: await this.airbnb.refresh(user) };
  }

  /** GET /airbnb-listings → the pilot listing only, others counted. */
  @Get('listings')
  async listings(@CurrentUser() user: JwtPayload) {
    return { data: await this.airbnb.listings(user) };
  }
}
