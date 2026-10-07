import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PricingRulesService } from './pricing-rules.service';
import { CreateRuleDto } from './dto/pricing-rules.dto';

/**
 * «Цены → Автоправила». Every route answers 503 while ZODOMUS_PROMOTIONS_AUTORULES_ENABLED=false.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('pricing/rules')
export class PricingRulesController {
  constructor(private readonly rules: PricingRulesService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { data: await this.rules.list(user) };
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() body: CreateRuleDto) {
    return { data: await this.rules.create(user, body) };
  }

  @Post(':groupId/deactivate')
  async deactivate(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return { data: await this.rules.setActive(user, groupId, false) };
  }

  @Post(':groupId/activate')
  async activate(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    return { data: await this.rules.setActive(user, groupId, true) };
  }

  @Post(':groupId/properties/:propertyId/deactivate')
  async deactivateForProperty(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.rules.setPropertyActive(user, groupId, propertyId, false) };
  }

  @Post(':groupId/properties/:propertyId/activate')
  async activateForProperty(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return { data: await this.rules.setPropertyActive(user, groupId, propertyId, true) };
  }

  /** Send again where the rule was only simulated (test mode), failed or was skipped. */
  @Post(':groupId/resend')
  async resend(@CurrentUser() user: JwtPayload, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return { data: await this.rules.resend(user, groupId) };
  }
}
