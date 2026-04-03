import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OtaPlatformService } from './ota-platform.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('OTA platforms')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('ota-platforms')
export class OtaPlatformController {
  constructor(private readonly otaPlatformService: OtaPlatformService) {}

  /** Справочник каналов (Booking, Airbnb, …) для формы объекта. */
  @Get()
  @Roles('OWNER', 'MANAGER')
  async list() {
    const data = await this.otaPlatformService.findAll();
    return { data };
  }
}
