import { Controller, Delete, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { UserService } from '../user/user.service';
import { UnmappedReportsService } from './unmapped-reports.service';

@ApiTags('Telegram unmapped')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('telegram/unmapped-reports')
export class UnmappedReportsController {
  constructor(
    private readonly unmappedReportsService: UnmappedReportsService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  async list(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const reports = await this.unmappedReportsService.listForTenant(ownerId);
    return { data: { reports } };
  }

  @Get('count')
  @Roles('OWNER', 'MANAGER')
  async count(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const count = await this.unmappedReportsService.countForTenant(ownerId);
    return { data: { count } };
  }

  @Post(':id/attach')
  @Roles('OWNER', 'MANAGER')
  async attach(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { taskId: string },
  ) {
    await this.unmappedReportsService.attachToTask(id, body.taskId.trim(), user.sub, user.role);
    return { data: { ok: true as const } };
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  async dismiss(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.unmappedReportsService.dismiss(id, user.sub, user.role);
    return { data: { ok: true as const } };
  }
}
