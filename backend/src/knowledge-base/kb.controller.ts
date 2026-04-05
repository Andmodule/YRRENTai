import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { KbImprovementService } from './kb-improvement.service';
import { UserService } from '../user/user.service';

@ApiTags('Knowledge Base — improvement queue')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('kb')
export class KbController {
  constructor(
    private readonly kbImprovement: KbImprovementService,
    private readonly userService: UserService,
  ) {}

  @Get('pending')
  @Roles('OWNER', 'MANAGER')
  async pending(
    @CurrentUser() user: JwtPayload,
    @Query('days') daysRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const days = Math.min(Math.max(parseInt(daysRaw ?? '30', 10) || 30, 1), 365);
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '200', 10) || 200, 1), 500);
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.kbImprovement.findPending(ownerId, days, limit);
    return { data };
  }

  @Post('bulk-add')
  @Roles('OWNER', 'MANAGER')
  async bulkAdd(@CurrentUser() user: JwtPayload, @Body() body: { ids: string[] }) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const result = await this.kbImprovement.bulkAddToKb(ownerId, body?.ids ?? []);
    return { data: result };
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async patch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { guestQuestion?: string; managerAnswer?: string },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.kbImprovement.updatePending(ownerId, id, {
      guestQuestion: body?.guestQuestion,
      managerAnswer: body?.managerAnswer,
    });
    return { data };
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    await this.kbImprovement.ignore(ownerId, id);
    return { data: null };
  }
}
