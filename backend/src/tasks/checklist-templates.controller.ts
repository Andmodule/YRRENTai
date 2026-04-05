import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ChecklistService } from './checklist.service';
import { UserService } from '../user/user.service';

@ApiTags('Checklist templates')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(
    private readonly checklistService: ChecklistService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  async list(@CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const templates = await this.checklistService.listTemplates(ownerId);
    return { data: { templates } };
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name: string;
      autoApplyToType: string | null;
      propertyId: string | null;
      items: { text: string; required: boolean; sortOrder: number }[];
    },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const template = await this.checklistService.createTemplate(ownerId, body);
    return { data: { template } };
  }

  @Patch(':uuid')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('uuid') uuid: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name?: string;
      autoApplyToType?: string | null;
      propertyId?: string | null;
    },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const template = await this.checklistService.updateTemplate(ownerId, uuid, body);
    return { data: { template } };
  }

  @Post(':uuid/items')
  @Roles('OWNER', 'MANAGER')
  async addItem(
    @Param('uuid') uuid: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { text: string; required: boolean; sortOrder: number },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const template = await this.checklistService.addTemplateItem(ownerId, uuid, body);
    return { data: { template } };
  }

  @Patch(':uuid/items/:itemId')
  @Roles('OWNER', 'MANAGER')
  async updateItem(
    @Param('uuid') uuid: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { text?: string; required?: boolean; sortOrder?: number },
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const template = await this.checklistService.updateTemplateItem(ownerId, uuid, itemId, body);
    return { data: { template } };
  }

  @Delete(':uuid/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER', 'MANAGER')
  async deleteItem(
    @Param('uuid') uuid: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    await this.checklistService.deleteTemplateItem(ownerId, uuid, itemId);
  }

  @Delete(':uuid')
  @Roles('OWNER', 'MANAGER')
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    await this.checklistService.deleteTemplate(ownerId, uuid);
    return { data: { ok: true } };
  }
}
