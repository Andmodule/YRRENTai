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

@ApiTags('Knowledge Base — improvement queue')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('kb')
export class KbController {
  constructor(private readonly kbImprovement: KbImprovementService) {}

  @Get('pending')
  @Roles('OWNER', 'MANAGER')
  async pending(
    @CurrentUser() user: JwtPayload,
    @Query('days') daysRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const days = Math.min(Math.max(parseInt(daysRaw ?? '30', 10) || 30, 1), 365);
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '200', 10) || 200, 1), 500);
    const data = await this.kbImprovement.findPending(user.sub, days, limit);
    return { data };
  }

  @Post('bulk-add')
  @Roles('OWNER', 'MANAGER')
  async bulkAdd(@CurrentUser() user: JwtPayload, @Body() body: { ids: string[] }) {
    const result = await this.kbImprovement.bulkAddToKb(user.sub, body?.ids ?? []);
    return { data: result };
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async patch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { guestQuestion?: string; managerAnswer?: string },
  ) {
    const data = await this.kbImprovement.updatePending(user.sub, id, {
      guestQuestion: body?.guestQuestion,
      managerAnswer: body?.managerAnswer,
    });
    return { data };
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.kbImprovement.ignore(user.sub, id);
    return { data: null };
  }
}
