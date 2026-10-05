import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingService } from './pricing.service';
import {
  AccessCheckDto,
  CreatePromotionDto,
  PricingSettingsDto,
  UpdatePromotionDto,
} from './dto/pricing.dto';

/**
 * «Цены»: Booking promotions («Скидки») and per-property minimum prices («Минимальные цены»).
 * Everything except GET /status answers 503 while ZODOMUS_PROMOTIONS_ENABLED=false.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('status')
  status() {
    return { data: this.pricing.status() };
  }

  // ─── Минимальные цены ──────────────────────────────────────────────────────

  @Get('properties')
  async properties(@CurrentUser() user: JwtPayload) {
    return { data: await this.pricing.listProperties(user) };
  }

  @Patch('properties/settings')
  async updateSettings(@CurrentUser() user: JwtPayload, @Body() body: PricingSettingsDto) {
    return { data: await this.pricing.updateSettings(user, body) };
  }

  @Post('properties/access-check')
  async accessCheck(@CurrentUser() user: JwtPayload, @Body() body: AccessCheckDto) {
    return { data: await this.pricing.accessCheck(user, body.propertyIds) };
  }

  @Get('properties/:propertyId/price-today')
  async priceToday(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.pricing.priceToday(user, propertyId) };
  }

  // ─── Скидки ────────────────────────────────────────────────────────────────

  @Get('promotions')
  async list(@CurrentUser() user: JwtPayload) {
    return { data: await this.pricing.list(user) };
  }

  @Post('promotions/preview')
  async preview(@CurrentUser() user: JwtPayload, @Body() body: CreatePromotionDto) {
    return { data: await this.pricing.preview(user, body) };
  }

  @Post('promotions')
  async create(@CurrentUser() user: JwtPayload, @Body() body: CreatePromotionDto) {
    return { data: await this.pricing.create(user, body) };
  }

  @Get('promotions/:id')
  async get(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pricing.get(user, id) };
  }

  @Patch('promotions/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromotionDto,
  ) {
    return { data: await this.pricing.update(user, id, body) };
  }

  @Post('promotions/:id/deactivate')
  async deactivate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pricing.setPromotionActive(user, id, false) };
  }

  @Post('promotions/:id/activate')
  async activate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pricing.setPromotionActive(user, id, true) };
  }

  @Post('promotions/:id/properties/:propertyId/deactivate')
  async deactivateForProperty(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.pricing.targetAction(user, id, propertyId, 'off') };
  }

  @Post('promotions/:id/properties/:propertyId/activate')
  async activateForProperty(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.pricing.targetAction(user, id, propertyId, 'on') };
  }

  @Post('promotions/:id/properties/:propertyId/retry')
  async retryForProperty(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.pricing.targetAction(user, id, propertyId, 'retry') };
  }
}
