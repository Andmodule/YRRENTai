import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BookingService } from './booking.service';
import { CreateBookingDto, PatchBookingDto } from './dto/create-booking.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(@Body() dto: CreateBookingDto, @CurrentUser() user: JwtPayload) {
    const booking = await this.bookingService.create(dto, user.sub);
    return { data: booking };
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  async findAll(@Query('propertyId') propertyId: string, @CurrentUser() user: JwtPayload) {
    const rows = await this.bookingService.findAllByProperty(propertyId, user.sub);
    return { data: rows };
  }

  /** Live availability hint for the new-booking form (same rules as create). */
  @Get('conflict-preview')
  @Roles('OWNER', 'MANAGER')
  async conflictPreview(
    @Query('propertyId') propertyId: string,
    @Query('checkIn') checkIn: string,
    @Query('checkOut') checkOut: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!propertyId?.trim() || !checkIn?.trim() || !checkOut?.trim()) {
      throw new BadRequestException('propertyId, checkIn, checkOut are required');
    }
    const data = await this.bookingService.previewConflict(propertyId, checkIn, checkOut, user.sub);
    return { data };
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const booking = await this.bookingService.findOne(id, user.sub);
    return { data: booking };
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async patch(
    @Param('id') id: string,
    @Body() dto: PatchBookingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const booking = await this.bookingService.patch(id, dto, user.sub);
    return { data: booking };
  }

  @Patch(':id/status')
  @Roles('OWNER', 'MANAGER')
  async transition(
    @Param('id') id: string,
    @Body() dto: { status: string; cancelledBy?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const booking = await this.bookingService.transition(id, dto.status, user.sub, dto.cancelledBy);
    return { data: booking };
  }
}
