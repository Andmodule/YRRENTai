import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PropertyService } from '../property/property.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(private readonly propertyService: PropertyService) {}

  @Get()
  @Roles('SUPERADMIN')
  async listAll(): Promise<{ data: Awaited<ReturnType<PropertyService['findAllForAdmin']>> }> {
    const data = await this.propertyService.findAllForAdmin();
    return { data };
  }
}
