import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { AutomationsService } from './automations.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.schema';
import { listRulesQuerySchema } from './dto/list-rules-query.schema';
import { UpdateRuleParamsDto } from './dto/update-rule-params.dto';
import { UpdateRuleStatusDto } from './dto/update-rule-status.dto';

@ApiTags('Automations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get('rules')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({ summary: 'List automation rules for a property and category' })
  async listRules(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string | undefined,
    @Query('category') category: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<AutomationsService['listRules']>> }> {
    const parsed = listRulesQuerySchema.safeParse({ propertyId, category });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const data = await this.automationsService.listRules(parsed.data, user);
    return { data };
  }

  @Post('rules')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({ summary: 'Create an automation rule for a property (unique per propertyId + key)' })
  async createRule(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateAutomationRuleDto,
  ): Promise<{ data: Awaited<ReturnType<AutomationsService['createRule']>> }> {
    const data = await this.automationsService.createRule(body, user);
    return { data };
  }

  @Patch('rules/:id/status')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({ summary: 'Update automation rule status (active / inactive)' })
  async patchRuleStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRuleStatusDto,
  ): Promise<{ data: Awaited<ReturnType<AutomationsService['updateRuleStatus']>> }> {
    const data = await this.automationsService.updateRuleStatus(id, body, user);
    return { data };
  }

  @Patch('rules/:id/params')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({ summary: 'Merge-update automation rule params (JSON object)' })
  async patchRuleParams(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRuleParamsDto,
  ): Promise<{ data: Awaited<ReturnType<AutomationsService['updateRuleParams']>> }> {
    const data = await this.automationsService.updateRuleParams(id, body, user);
    return { data };
  }
}
