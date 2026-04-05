import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PropertyService } from './property.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/create-property.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { UserService } from '../user/user.service';

@ApiTags('Properties')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('properties')
export class PropertyController {
  constructor(
    private readonly propertyService: PropertyService,
    private readonly userService: UserService,
  ) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(@Body() dto: CreatePropertyDto, @CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const property = await this.propertyService.create(dto, ownerId);
    return { data: property };
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  async findAll(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const properties = await this.propertyService.findAllByOwner(ownerId);
    return { data: properties };
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const property = await this.propertyService.findOneForUser(id, user.sub, user.role);
    return { data: property };
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async update(@Param('id') id: string, @Body() dto: UpdatePropertyDto, @CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const property = await this.propertyService.update(id, dto, ownerId);
    return { data: property };
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.propertyService.remove(id, user.sub);
    return { data: null };
  }
}
