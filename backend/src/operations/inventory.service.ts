import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyService } from '../property/property.service';
import { InventoryItemEntity, InventoryCategory } from './entities/inventory-item.entity';
import {
  InventoryMovementEntity,
  InventoryMovementReason,
} from './entities/inventory-movement.entity';

export interface InventoryItemDto {
  id: string;
  propertyId: string;
  name: string;
  sku: string | null;
  category: InventoryCategory;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovementDto {
  id: string;
  itemId: string;
  delta: number;
  reason: InventoryMovementReason;
  taskId: string | null;
  note: string | null;
  createdAt: string;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItemEntity)
    private readonly itemRepo: Repository<InventoryItemEntity>,
    @InjectRepository(InventoryMovementEntity)
    private readonly movementRepo: Repository<InventoryMovementEntity>,
    private readonly propertyService: PropertyService,
  ) {}

  private toItemDto(e: InventoryItemEntity): InventoryItemDto {
    return {
      id: e.id,
      propertyId: e.propertyId,
      name: e.name,
      sku: e.sku,
      category: e.category,
      unit: e.unit,
      currentStock: e.currentStock,
      lowStockThreshold: e.lowStockThreshold,
      notes: e.notes,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toMovementDto(e: InventoryMovementEntity): InventoryMovementDto {
    return {
      id: e.id,
      itemId: e.itemId,
      delta: e.delta,
      reason: e.reason,
      taskId: e.taskId,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    };
  }

  async listItems(ownerId: string, propertyId?: string): Promise<InventoryItemDto[]> {
    const qb = this.itemRepo
      .createQueryBuilder('i')
      .innerJoin('i.property', 'p')
      .where('p.ownerId = :ownerId', { ownerId })
      .orderBy('i.name', 'ASC');

    if (propertyId) {
      qb.andWhere('i.propertyId = :propertyId', { propertyId });
    }

    const rows = await qb.getMany();
    return rows.map((r) => this.toItemDto(r));
  }

  async createItem(
    ownerId: string,
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
  ): Promise<InventoryItemDto> {
    await this.propertyService.findOne(body.propertyId, ownerId);
    const row = this.itemRepo.create({
      propertyId: body.propertyId,
      name: body.name.trim(),
      sku: body.sku?.trim() || null,
      category: body.category ?? 'other',
      unit: body.unit?.trim() || 'pcs',
      currentStock: body.currentStock ?? 0,
      lowStockThreshold: body.lowStockThreshold ?? 0,
      notes: body.notes?.trim() || null,
    });
    const saved = await this.itemRepo.save(row);
    return this.toItemDto(saved);
  }

  async updateItem(
    ownerId: string,
    id: string,
    body: Partial<{
      name: string;
      sku: string | null;
      category: InventoryCategory;
      unit: string;
      lowStockThreshold: number;
      notes: string | null;
    }>,
  ): Promise<InventoryItemDto> {
    const item = await this.itemRepo.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.property.ownerId !== ownerId) throw new ForbiddenException();

    if (body.name !== undefined) item.name = body.name.trim();
    if (body.sku !== undefined) item.sku = body.sku?.trim() || null;
    if (body.category !== undefined) item.category = body.category;
    if (body.unit !== undefined) item.unit = body.unit.trim() || 'pcs';
    if (body.lowStockThreshold !== undefined) item.lowStockThreshold = body.lowStockThreshold;
    if (body.notes !== undefined) item.notes = body.notes?.trim() || null;

    const saved = await this.itemRepo.save(item);
    return this.toItemDto(saved);
  }

  async deleteItem(ownerId: string, id: string): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.property.ownerId !== ownerId) throw new ForbiddenException();
    await this.itemRepo.remove(item);
  }

  async addMovement(
    ownerId: string,
    userId: string,
    itemId: string,
    body: {
      delta: number;
      reason: InventoryMovementReason;
      taskId?: string | null;
      note?: string | null;
    },
  ): Promise<{ item: InventoryItemDto; movement: InventoryMovementDto }> {
    if (!Number.isFinite(body.delta) || body.delta === 0) {
      throw new BadRequestException('delta must be non-zero');
    }

    const item = await this.itemRepo.findOne({
      where: { id: itemId },
      relations: ['property'],
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.property.ownerId !== ownerId) throw new ForbiddenException();

    const next = item.currentStock + body.delta;
    if (next < 0) {
      throw new BadRequestException('Stock cannot be negative');
    }

    item.currentStock = next;
    await this.itemRepo.save(item);

    const mov = this.movementRepo.create({
      itemId: item.id,
      delta: body.delta,
      reason: body.reason,
      taskId: body.taskId ?? null,
      createdBy: userId,
      note: body.note?.trim() || null,
    });
    const savedMov = await this.movementRepo.save(mov);

    return {
      item: this.toItemDto(item),
      movement: this.toMovementDto(savedMov),
    };
  }

  async listMovements(ownerId: string, itemId: string, limit = 50): Promise<InventoryMovementDto[]> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId },
      relations: ['property'],
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (item.property.ownerId !== ownerId) throw new ForbiddenException();

    const rows = await this.movementRepo.find({
      where: { itemId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => this.toMovementDto(r));
  }
}
