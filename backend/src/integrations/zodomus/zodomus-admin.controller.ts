import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ZodomusService } from './zodomus.service';
import { CreateZodomusTestReservationDto } from './dto/create-zodomus-test-reservation.dto';
import { PropertyService } from '../../property/property.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * SUPERADMIN-only proxies to Zodomus upstream (room-rates, queue, createtest).
 * Uses internal RentAI property UUID; resolves zodomusPropertyId on the server.
 */
@ApiTags('Zodomus Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('admin/zodomus')
export class ZodomusAdminController {
  constructor(
    private readonly zodomus: ZodomusService,
    private readonly propertyService: PropertyService,
  ) {}

  @Get('room-rates')
  @Roles('SUPERADMIN')
  async roomRates(
    @Query('channelId') channelId: string,
    @Query('propertyId') propertyId: string,
  ): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(channelId);
    const pid = propertyId?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = prop.zodomusPropertyId?.trim();
    if (!ext) {
      throw new BadRequestException('Property has no zodomusPropertyId');
    }
    const data = await this.zodomus.getRoomRates(channel, ext);
    return { data };
  }

  @Get('availability')
  @Roles('SUPERADMIN')
  async availability(
    @Query('channelId') channelId: string,
    @Query('propertyId') propertyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(channelId);
    const pid = propertyId?.trim();
    const df = dateFrom?.trim();
    const dt = dateTo?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    if (!df || !dt) {
      throw new BadRequestException('dateFrom and dateTo are required (YYYY-MM-DD)');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = prop.zodomusPropertyId?.trim();
    if (!ext) {
      throw new BadRequestException('Property has no zodomusPropertyId');
    }
    const data = await this.zodomus.getAvailability(channel, ext, df, dt);
    return { data };
  }

  @Get('reservations-queue')
  @Roles('SUPERADMIN')
  async reservationsQueue(
    @Query('channelId') channelId: string,
    @Query('propertyId') propertyId: string,
  ): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(channelId);
    const pid = propertyId?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = prop.zodomusPropertyId?.trim();
    if (!ext) {
      throw new BadRequestException('Property has no zodomusPropertyId');
    }
    const data = await this.zodomus.getReservationQueue(channel, ext);
    return { data };
  }

  /** POST /reservations-createtest — E2E: Zodomus may call your webhook, then sync picks up queue. */
  @Post('create-test-reservation')
  @Roles('SUPERADMIN')
  async createTestReservation(
    @Body() dto: CreateZodomusTestReservationDto,
  ): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(dto.channelId);
    const pid = dto.propertyId?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = prop.zodomusPropertyId?.trim();
    if (!ext) {
      throw new BadRequestException('Property has no zodomusPropertyId');
    }
    const status = dto.status ?? 'new';
    const data = await this.zodomus.createTestReservation(channel, ext, {
      status,
      reservationId: dto.reservationId,
    });
    return { data };
  }
}
