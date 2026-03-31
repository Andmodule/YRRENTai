import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { addDays, format } from 'date-fns';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';
import { ListingTranslationsService } from './listing-translations.service';
import { ManagerReportsService } from './manager-reports.service';
import type { InventoryCategory } from './entities/inventory-item.entity';
import type { InventoryMovementReason } from './entities/inventory-movement.entity';

@ApiTags('Operations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly listingTranslationsService: ListingTranslationsService,
    private readonly managerReportsService: ManagerReportsService,
  ) {}

  @Get('reports/summary')
  @Roles('OWNER', 'MANAGER')
  async reportSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromParam: string | undefined,
    @Query('to') toParam: string | undefined,
  ) {
    const from = fromParam?.trim() || format(addDays(new Date(), -30), 'yyyy-MM-dd');
    const to = toParam?.trim() || format(new Date(), 'yyyy-MM-dd');
    const summary = await this.managerReportsService.getSummary(user.sub, from, to);
    return { data: summary };
  }

  @Get('inventory')
  @Roles('OWNER', 'MANAGER')
  async listInventory(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string | undefined,
  ) {
    const items = await this.inventoryService.listItems(user.sub, propertyId?.trim());
    return { data: { items } };
  }

  @Post('inventory')
  @Roles('OWNER', 'MANAGER')
  async createInventory(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      propertyId: string;
      name: string;
      sku?: string | null;
      category?: InventoryCategory;
      unit?: string;
      currentStock?: number;
      lowStockThreshold?: number;
      notes?: string | null;
    },
  ) {
    const item = await this.inventoryService.createItem(user.sub, body);
    return { data: { item } };
  }

  @Patch('inventory/:id')
  @Roles('OWNER', 'MANAGER')
  async patchInventory(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: Partial<{
      name: string;
      sku: string | null;
      category: InventoryCategory;
      unit: string;
      lowStockThreshold: number;
      notes: string | null;
    }>,
  ) {
    const item = await this.inventoryService.updateItem(user.sub, id, body);
    return { data: { item } };
  }

  @Delete('inventory/:id')
  @Roles('OWNER', 'MANAGER')
  async deleteInventory(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.inventoryService.deleteItem(user.sub, id);
    return { data: null };
  }

  @Post('inventory/:id/movements')
  @Roles('OWNER', 'MANAGER')
  async addMovement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      delta: number;
      reason: InventoryMovementReason;
      taskId?: string | null;
      note?: string | null;
    },
  ) {
    const result = await this.inventoryService.addMovement(user.sub, user.sub, id, body);
    return { data: result };
  }

  @Get('inventory/:id/movements')
  @Roles('OWNER', 'MANAGER')
  async listMovements(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
  ) {
    const movements = await this.inventoryService.listMovements(
      user.sub,
      id,
      limit ? Number(limit) : 50,
    );
    return { data: { movements } };
  }

  @Get('listings/:propertyId/translations')
  @Roles('OWNER', 'MANAGER')
  async listTranslations(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId') propertyId: string,
  ) {
    const translations = await this.listingTranslationsService.listForProperty(user.sub, propertyId);
    return { data: { translations } };
  }

  @Put('listings/:propertyId/translations/:locale')
  @Roles('OWNER', 'MANAGER')
  async putTranslation(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId') propertyId: string,
    @Param('locale') locale: string,
    @Body()
    body: {
      title?: string | null;
      shortDescription?: string | null;
      longDescription?: string | null;
    },
  ) {
    const translation = await this.listingTranslationsService.upsert(user.sub, propertyId, locale, body);
    return { data: { translation } };
  }

  @Delete('listings/:propertyId/translations/:locale')
  @Roles('OWNER', 'MANAGER')
  async deleteTranslation(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId') propertyId: string,
    @Param('locale') locale: string,
  ) {
    await this.listingTranslationsService.delete(user.sub, propertyId, locale);
    return { data: null };
  }
}
