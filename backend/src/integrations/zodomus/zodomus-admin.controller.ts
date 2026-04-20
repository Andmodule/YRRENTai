import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ZodomusService } from './zodomus.service';
import { CreateZodomusTestReservationDto } from './dto/create-zodomus-test-reservation.dto';
import { ZodomusPropertyActivationDto } from './dto/zodomus-property-activation.dto';
import { ZodomusPropertyCheckDto } from './dto/zodomus-property-check.dto';
import { PropertyService } from '../../property/property.service';
import { PropertyChannelListingEntity } from '../../property/entities/property-channel-listing.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodomusAvailabilityPushService } from './zodomus-availability-push.service';

/**
 * SUPERADMIN-only proxies to Zodomus upstream (price-model, property-activation, room-rates, queue, createtest).
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
    private readonly availabilityPush: ZodomusAvailabilityPushService,
    @InjectRepository(PropertyChannelListingEntity)
    private readonly channelListingRepo: Repository<PropertyChannelListingEntity>,
  ) {}

  /** GET /price-model — list valid price model ids for activation (no property required). */
  @Get('price-model')
  @Roles('SUPERADMIN')
  async priceModel(): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const data = await this.zodomus.getPriceModels();
    return { data };
  }

  /** POST /property-activation — OTA property id must already be saved on the RentAI property row. */
  @Post('property-activation')
  @Roles('SUPERADMIN')
  async propertyActivation(@Body() dto: ZodomusPropertyActivationDto): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(dto.channelId);
    const pid = dto.propertyId?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
    }
    const data = await this.zodomus.activateProperty(channel, ext, dto.priceModelId);
    return { data };
  }

  /** POST /property-check */
  @Post('property-check')
  @Roles('SUPERADMIN')
  async propertyCheck(@Body() dto: ZodomusPropertyCheckDto): Promise<{ data: unknown }> {
    if (!this.zodomus.isEnabled) {
      throw new BadRequestException('Zodomus is disabled');
    }
    const channel = Number(dto.channelId);
    const pid = dto.propertyId?.trim();
    if (!pid || !Number.isFinite(channel)) {
      throw new BadRequestException('channelId and propertyId are required');
    }
    const prop = await this.propertyService.findByIdForAdmin(pid);
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
    }
    const data = await this.zodomus.checkProperty(channel, ext);
    return { data };
  }

  /**
   * Which `roomId` RentAI uses for Zodomus `POST /availability` per target — compare to GET availability `rooms[].id`.
   */
  @Get('availability-push-targets')
  @Roles('SUPERADMIN')
  async availabilityPushTargets(@Query('propertyId') propertyId: string): Promise<{ data: unknown }> {
    const pid = propertyId?.trim();
    if (!pid) {
      throw new BadRequestException('propertyId is required');
    }
    await this.propertyService.findByIdForAdmin(pid);
    const data = await this.availabilityPush.describeAvailabilityPushTargets(pid);
    return { data };
  }

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
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
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
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
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
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
    }
    const data = await this.zodomus.getReservationQueue(channel, ext);
    return { data };
  }

  /**
   * GET /channel-mappings — diagnostic: all PropertyChannelListings with externalListingId.
   * Use to verify which internal property UUID maps to which Zodomus property id.
   */
  @Get('channel-mappings')
  @Roles('SUPERADMIN')
  async channelMappings(): Promise<{ data: unknown[] }> {
    const rows = await this.channelListingRepo.find({
      relations: ['property', 'otaPlatform'],
      order: { propertyId: 'ASC' },
    });
    const data = rows.map((r) => ({
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? null,
      otaPlatformCode: r.otaPlatform?.code ?? null,
      zodomusChannelId: r.otaPlatform?.zodomusChannelId ?? null,
      externalListingId: r.externalListingId ?? null,
    }));
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
    const ext = this.propertyService.getExternalListingIdForZodomusChannel(prop, channel);
    if (!ext) {
      throw new BadRequestException('Property has no external listing id for this channel');
    }
    const status = dto.status ?? 'new';
    const data = await this.zodomus.createTestReservation(channel, ext, {
      status,
      reservationId: dto.reservationId,
    });
    return { data };
  }
}
