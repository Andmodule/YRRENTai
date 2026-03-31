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

@ApiTags('Checklist templates')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly checklistService: ChecklistService) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  async list(@CurrentUser() user: JwtPayload) {
    const templates = await this.checklistService.listTemplates(user.sub);
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
    const template = await this.checklistService.createTemplate(user.sub, body);
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
    const template = await this.checklistService.updateTemplate(user.sub, uuid, body);
    return { data: { template } };
  }

  @Post(':uuid/items')
  @Roles('OWNER', 'MANAGER')
  async addItem(
    @Param('uuid') uuid: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { text: string; required: boolean; sortOrder: number },
  ) {
    const template = await this.checklistService.addTemplateItem(user.sub, uuid, body);
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
    const template = await this.checklistService.updateTemplateItem(user.sub, uuid, itemId, body);
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
    await this.checklistService.deleteTemplateItem(user.sub, uuid, itemId);
  }

  @Delete(':uuid')
  @Roles('OWNER', 'MANAGER')
  async remove(@Param('uuid') uuid: string, @CurrentUser() user: JwtPayload) {
    await this.checklistService.deleteTemplate(user.sub, uuid);
    return { data: { ok: true } };
  }
}
