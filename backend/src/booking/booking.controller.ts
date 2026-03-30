import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
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
    return this.bookingService.create(dto, user.sub);
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  async findAll(@Query('propertyId') propertyId: string, @CurrentUser() user: JwtPayload) {
    return this.bookingService.findAllByProperty(propertyId, user.sub);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.bookingService.findOne(id, user.sub);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'MANAGER')
  async transition(
    @Param('id') id: string,
    @Body() dto: { status: string; cancelledBy?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.transition(id, dto.status, user.sub, dto.cancelledBy);
  }
}
