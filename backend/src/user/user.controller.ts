import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: JwtPayload) {
    const profile = await this.userService.getPublicProfileById(user.sub);
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
