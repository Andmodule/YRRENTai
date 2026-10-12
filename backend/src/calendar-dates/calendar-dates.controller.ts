import { BadRequestException, Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CalendarDatesService, type CalendarDatesRequest } from './calendar-dates.service';
import { CalendarAutoOpenService } from './calendar-auto-open.service';
import { CalendarAutoOpenDto, CalendarDatesDto } from './dto/calendar-dates.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function propertyIdParam(v: string | undefined): string {
  const id = v?.trim() ?? '';
  if (!UUID.test(id)) throw new BadRequestException('propertyId is required');
  return id;
}

function toRequest(dto: CalendarDatesDto): CalendarDatesRequest {
  return {
    propertyId: dto.propertyId,
    action: dto.action,
    dateFrom: dto.dateFrom,
    dateToExclusive: dto.dateTo,
    weekdays: dto.weekdays ?? null,
    price: dto.price ?? null,
    weekendPrice: dto.weekendPrice ?? null,
    onlyClosed: dto.action === 'open' && dto.onlyClosed === true,
  };
}

/**
 * «Открыть / закрыть даты на Booking» and «Автопродление календаря».
 * Everything but `status` answers 503 while ZODOMUS_CALENDAR_DATES_ENABLED=false.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'MANAGER', 'SUPERADMIN')
@Controller('calendar-dates')
export class CalendarDatesController {
  constructor(
    private readonly dates: CalendarDatesService,
    private readonly auto: CalendarAutoOpenService,
  ) {}

  /** Which of the two tools the interface shows. */
  @Get('status')
  status() {
    return {
      data: {
        enabled: this.dates.enabled,
        auto: { enabled: this.auto.enabled, dryRun: this.auto.dryRun, hourUtc: this.auto.hourUtc },
      },
    };
  }

  /** What would change — reads Booking, writes nothing. */
  @Post('preview')
  async preview(@CurrentUser() user: JwtPayload, @Body() body: CalendarDatesDto) {
    return { data: await this.dates.preview(user, toRequest(body)) };
  }

  /** Starts sending to Booking in the background; follow it with GET job. */
  @Post('apply')
  async apply(@CurrentUser() user: JwtPayload, @Body() body: CalendarDatesDto) {
    return { data: await this.dates.start(user, toRequest(body)) };
  }

  @Get('job')
  async job(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId?: string) {
    return { data: await this.dates.job(user, propertyIdParam(propertyId)) };
  }

  @Get('auto')
  async getAuto(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId?: string) {
    return { data: await this.auto.get(user, propertyIdParam(propertyId)) };
  }

  @Put('auto')
  async saveAuto(@CurrentUser() user: JwtPayload, @Body() body: CalendarAutoOpenDto) {
    return { data: await this.auto.save(user, body) };
  }
}
