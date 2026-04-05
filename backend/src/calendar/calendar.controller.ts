import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { addDays, format } from 'date-fns';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import { UserService } from '../user/user.service';

@ApiTags('Calendar')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  async getCalendar(
    @Query('from') fromParam: string | undefined,
    @Query('to') toParam: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const today = new Date();
    const from = fromParam?.trim() || format(addDays(today, -3), 'yyyy-MM-dd');
    const to = toParam?.trim() || format(addDays(today, 18), 'yyyy-MM-dd');
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const payload = await this.calendarService.getCalendarData(ownerId, from, to);
    return { data: payload };
  }
}
