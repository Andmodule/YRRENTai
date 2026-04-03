import { Controller, Get, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { StaffMemberDto } from './interfaces/public-user.interface';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Returns STAFF/MANAGER users that belong to the calling owner's account.
   * Used to populate the assignee selector when creating/editing tasks.
   */
  @Get('staff')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async getStaff(@CurrentUser() user: JwtPayload): Promise<{ data: StaffMemberDto[] }> {
    const staff = await this.userService.findStaffByOwner(user.sub);
    return { data: staff };
  }

  @Get('me')
  async getProfile(@CurrentUser() user: JwtPayload) {
    const profile = await this.userService.getPublicProfileById(user.sub);
    return { data: profile };
  }

  @Post('me/shift-complete')
  @UseGuards(RolesGuard)
  @Roles('STAFF')
  async completeShift(@CurrentUser() user: JwtPayload) {
    const profile = await this.userService.markStaffShiftComplete(user.sub);
    return { data: profile };
  }

  @Get('me/telegram')
  async getTelegramSettings(@CurrentUser() user: JwtPayload) {
    const profile = await this.userService.getPublicProfileById(user.sub);
    return { data: { telegramChatId: profile.telegramChatId } };
  }

  @Patch('me/telegram')
  async updateTelegramSettings(
    @CurrentUser() user: JwtPayload,
    @Body() body: { telegramChatId: string | null },
  ) {
    const updated = await this.userService.updateTelegramChatId(user.sub, body.telegramChatId);
    return { data: { telegramChatId: updated.telegramChatId } };
  }
}
