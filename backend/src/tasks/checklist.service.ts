import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ChecklistTemplateEntity } from './entities/checklist-template.entity';
import { ChecklistTemplateItemEntity } from './entities/checklist-template-item.entity';
import { TaskChecklistItemEntity } from './entities/task-checklist-item.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksGateway } from './tasks.gateway';
import { PropertyEntity } from '../property/entities/property.entity';

export interface TaskChecklistItemDto {
  uuid: string;
  text: string;
  required: boolean;
  sortOrder: number;
  checked: boolean;
  checkedAt: string | null;
}

export interface ChecklistTemplateDto {
  uuid: string;
  name: string;
  autoApplyToType: string | null;
  propertyId: string | null;
  createdAt: string;
  items: { uuid: string; text: string; required: boolean; sortOrder: number }[];
}

@Injectable()
export class ChecklistService {
  constructor(
    @InjectRepository(ChecklistTemplateEntity)
    private readonly templateRepo: Repository<ChecklistTemplateEntity>,
    @InjectRepository(ChecklistTemplateItemEntity)
    private readonly templateItemRepo: Repository<ChecklistTemplateItemEntity>,
    @InjectRepository(TaskChecklistItemEntity)
    private readonly taskItemRepo: Repository<TaskChecklistItemEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
    private readonly tasksGateway: TasksGateway,
  ) {}

  private async assertPropertyOwnedBy(ownerId: string, propertyId: string | null): Promise<void> {
    if (propertyId === null) return;
    const p = await this.propertyRepo.findOne({ where: { id: propertyId, ownerId } });
    if (!p) throw new BadRequestException('Property not found or not owned by user');
  }

  /** After a new task row is persisted. No-op if no matching template. */
  async applyAutoTemplateIfAny(taskId: string): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['property'],
    });
    if (!task?.property) return;

    const template = await this.findBestAutoTemplate(
      task.propertyId,
      task.type,
      task.property.ownerId,
    );
    if (!template) return;

    const items = await this.templateItemRepo.find({
      where: { templateId: template.id },
      order: { sortOrder: 'ASC' },
    });
    for (const it of items) {
      await this.taskItemRepo.save(
        this.taskItemRepo.create({
          taskId: task.id,
          text: it.text,
          required: it.required,
          sortOrder: it.sortOrder,
          checked: false,
          checkedAt: null,
          checkedBy: null,
        }),
      );
    }
  }

  private async findBestAutoTemplate(
    propertyId: string,
    taskType: string,
    ownerId: string,
  ): Promise<ChecklistTemplateEntity | null> {
    const specific = await this.templateRepo.findOne({
      where: {
        ownerId,
        autoApplyToType: taskType,
        propertyId,
      },
    });
    if (specific) return specific;

    return this.templateRepo.findOne({
      where: {
        ownerId,
        autoApplyToType: taskType,
        propertyId: IsNull(),
      },
    });
  }

  /** Batch summaries for task list DTOs. */
  async summariesForTasks(
    taskIds: string[],
  ): Promise<Map<string, { total: number; checked: number; requiredUnchecked: number }>> {
    const map = new Map<string, { total: number; checked: number; requiredUnchecked: number }>();
    if (taskIds.length === 0) return map;
    const rows = await this.taskItemRepo.find({ where: { taskId: In(taskIds) } });
    const byTask = new Map<string, TaskChecklistItemEntity[]>();
    for (const r of rows) {
      const arr = byTask.get(r.taskId) ?? [];
      arr.push(r);
      byTask.set(r.taskId, arr);
    }
    for (const id of taskIds) {
      const items = byTask.get(id) ?? [];
      if (items.length === 0) continue;
      const checked = items.filter((i) => i.checked).length;
      const requiredUnchecked = items.filter((i) => i.required && !i.checked).length;
      map.set(id, { total: items.length, checked, requiredUnchecked });
    }
    return map;
  }

  async listForTask(taskId: string): Promise<TaskChecklistItemDto[]> {
    const rows = await this.taskItemRepo.find({
      where: { taskId },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((r) => ({
      uuid: r.id,
      text: r.text,
      required: r.required,
      sortOrder: r.sortOrder,
      checked: r.checked,
      checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
    }));
  }

  async checklistSummary(taskId: string): Promise<{
    total: number;
    checked: number;
    requiredUnchecked: number;
  } | null> {
    const rows = await this.taskItemRepo.find({ where: { taskId } });
    if (rows.length === 0) return null;
    const checked = rows.filter((r) => r.checked).length;
    const requiredUnchecked = rows.filter((r) => r.required && !r.checked).length;
    return { total: rows.length, checked, requiredUnchecked };
  }

  async assertCanCompleteTask(taskId: string): Promise<{ ok: true } | { ok: false; unchecked: string[] }> {
    const pending = await this.taskItemRepo.find({
      where: { taskId, required: true, checked: false },
    });
    if (pending.length === 0) return { ok: true };
    return { ok: false, unchecked: pending.map((p) => p.text) };
  }

  async patchItem(
    taskId: string,
    itemId: string,
    userId: string,
    role: string,
    checked: boolean,
  ): Promise<TaskChecklistItemDto> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['property', 'assignee'],
    });
    if (!task) throw new NotFoundException('Task not found');

    if (role === 'STAFF') {
      if (task.assigneeId !== userId) throw new ForbiddenException();
    } else if (task.property.ownerId !== userId) {
      throw new ForbiddenException();
    }

    const item = await this.taskItemRepo.findOne({ where: { id: itemId, taskId } });
    if (!item) throw new NotFoundException('Checklist item not found');

    item.checked = checked;
    item.checkedAt = checked ? new Date() : null;
    item.checkedBy = checked ? userId : null;
    await this.taskItemRepo.save(item);

    this.tasksGateway.emitChecklistItemUpdated({ taskId, itemId, checked });

    return {
      uuid: item.id,
      text: item.text,
      required: item.required,
      sortOrder: item.sortOrder,
      checked: item.checked,
      checkedAt: item.checkedAt ? item.checkedAt.toISOString() : null,
    };
  }

  // --- Templates (OWNER/MANAGER) ---

  async listTemplates(ownerId: string): Promise<ChecklistTemplateDto[]> {
    const list = await this.templateRepo.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      relations: ['items'],
    });
    return list.map((t) => ({
      uuid: t.id,
      name: t.name,
      autoApplyToType: t.autoApplyToType,
      propertyId: t.propertyId,
      createdAt: t.createdAt.toISOString(),
      items: (t.items ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          uuid: i.id,
          text: i.text,
          required: i.required,
          sortOrder: i.sortOrder,
        })),
    }));
  }

  async createTemplate(
    ownerId: string,
    body: {
      name: string;
      autoApplyToType: string | null;
      propertyId: string | null;
      items: { text: string; required: boolean; sortOrder: number }[];
    },
  ): Promise<ChecklistTemplateDto> {
    await this.assertPropertyOwnedBy(ownerId, body.propertyId);
    const t = this.templateRepo.create({
      name: body.name.trim(),
      autoApplyToType: body.autoApplyToType,
      propertyId: body.propertyId,
      ownerId,
    });
    const saved = await this.templateRepo.save(t);
    for (const it of body.items) {
      await this.templateItemRepo.save(
        this.templateItemRepo.create({
          templateId: saved.id,
          text: it.text.trim(),
          required: it.required,
          sortOrder: it.sortOrder,
        }),
      );
    }
    const full = await this.templateRepo.findOne({
      where: { id: saved.id },
      relations: ['items'],
    });
    if (!full) throw new NotFoundException();
    return (await this.listTemplates(ownerId)).find((x) => x.uuid === full.id)!;
  }

  async deleteTemplate(ownerId: string, templateId: string): Promise<void> {
    const t = await this.templateRepo.findOne({ where: { id: templateId, ownerId } });
    if (!t) throw new NotFoundException();
    await this.templateRepo.remove(t);
  }

  async updateTemplate(
    ownerId: string,
    templateId: string,
    dto: Partial<{
      name: string;
      autoApplyToType: string | null;
      propertyId: string | null;
    }>,
  ): Promise<ChecklistTemplateDto> {
    const t = await this.templateRepo.findOne({ where: { id: templateId, ownerId } });
    if (!t) throw new NotFoundException();
    if (dto.propertyId !== undefined) {
      await this.assertPropertyOwnedBy(ownerId, dto.propertyId);
    }
    if (dto.name !== undefined) t.name = dto.name.trim();
    if (dto.autoApplyToType !== undefined) t.autoApplyToType = dto.autoApplyToType;
    if (dto.propertyId !== undefined) t.propertyId = dto.propertyId;
    await this.templateRepo.save(t);
    return (await this.listTemplates(ownerId)).find((x) => x.uuid === templateId)!;
  }

  async addTemplateItem(
    ownerId: string,
    templateId: string,
    dto: { text: string; required: boolean; sortOrder: number },
  ): Promise<ChecklistTemplateDto> {
    const t = await this.templateRepo.findOne({ where: { id: templateId, ownerId } });
    if (!t) throw new NotFoundException();
    await this.templateItemRepo.save(
      this.templateItemRepo.create({
        templateId: t.id,
        text: dto.text.trim(),
        required: dto.required,
        sortOrder: dto.sortOrder,
      }),
    );
    return (await this.listTemplates(ownerId)).find((x) => x.uuid === templateId)!;
  }

  async updateTemplateItem(
    ownerId: string,
    templateId: string,
    itemId: string,
    dto: Partial<{ text: string; required: boolean; sortOrder: number }>,
  ): Promise<ChecklistTemplateDto> {
    const t = await this.templateRepo.findOne({ where: { id: templateId, ownerId } });
    if (!t) throw new NotFoundException();
    const item = await this.templateItemRepo.findOne({ where: { id: itemId, templateId: t.id } });
    if (!item) throw new NotFoundException();
    if (dto.text !== undefined) item.text = dto.text.trim();
    if (dto.required !== undefined) item.required = dto.required;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    await this.templateItemRepo.save(item);
    return (await this.listTemplates(ownerId)).find((x) => x.uuid === templateId)!;
  }

  async deleteTemplateItem(ownerId: string, templateId: string, itemId: string): Promise<void> {
    const t = await this.templateRepo.findOne({ where: { id: templateId, ownerId } });
    if (!t) throw new NotFoundException();
    const item = await this.templateItemRepo.findOne({ where: { id: itemId, templateId: t.id } });
    if (!item) throw new NotFoundException();
    await this.templateItemRepo.remove(item);
  }
}
