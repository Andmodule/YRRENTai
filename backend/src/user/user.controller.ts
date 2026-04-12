import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateStaffInviteDto } from './dto/create-staff-invite.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import type {
  StaffMemberDto,
  StaffPersonnelPayloadDto,
  StaffInviteCreatedDto,
  StaffInviteLinkPayloadDto,
  StaffDirectoryRowDto,
} from './interfaces/public-user.interface';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * STAFF-only directory for the tenant (strict employer link). Used by /dashboard/staff.
   */
  @Get('staff/personnel')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async getStaffPersonnel(@CurrentUser() user: JwtPayload): Promise<{ data: StaffPersonnelPayloadDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.findStaffDirectoryForTenant(ownerId);
    return { data };
  }

  /**
   * Creates a STAFF stub user and returns a Telegram deep link with invite token (24h).
   */
  @Post('staff/invite')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async inviteStaff(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateStaffInviteDto,
  ): Promise<{ data: StaffInviteCreatedDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.createStaffInviteAndUser(ownerId, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      jobType: body.jobType,
      telegramUsername: body.telegramUsername,
    });
    return { data };
  }

  @Patch('staff/:id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async updateStaff(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) staffId: string,
    @Body() body: UpdateStaffDto,
  ): Promise<{ data: StaffDirectoryRowDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.updateStaffMember(ownerId, staffId, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      jobType: body.jobType,
      telegramUsername: body.telegramUsername,
    });
    return { data };
  }

  @Get('staff/:id/invite')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async getStaffInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) staffId: string,
  ): Promise<{ data: StaffInviteLinkPayloadDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.getActiveStaffInviteLink(ownerId, staffId);
    return { data };
  }

  @Post('staff/:id/invite/regenerate')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async regenerateStaffInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) staffId: string,
  ): Promise<{ data: StaffInviteCreatedDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.regenerateStaffInviteLink(ownerId, staffId);
    return { data };
  }

  /** Очистить `telegramChatId` у сотрудника (отвязать бота). */
  @Post('staff/:id/telegram/unlink')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async unlinkStaffTelegram(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) staffId: string,
  ): Promise<{ data: StaffDirectoryRowDto }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const data = await this.userService.unlinkStaffTelegramChat(ownerId, staffId);
    return { data };
  }

  /**
   * Returns STAFF/MANAGER users that belong to the calling owner's account.
   * Used to populate the assignee selector when creating/editing tasks.
   */
  @Get('staff')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'MANAGER')
  async getStaff(@CurrentUser() user: JwtPayload): Promise<{ data: StaffMemberDto[] }> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const staff = await this.userService.findStaffByOwner(ownerId);
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
