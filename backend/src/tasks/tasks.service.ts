import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { format } from 'date-fns';
import { TaskEntity } from './entities/task.entity';
import { TaskNoteEntity } from './entities/task-note.entity';
import { TasksGateway } from './tasks.gateway';

export interface TaskDto {
  uuid: string;
  type: string;
  status: string;
  priority: string;
  propertyId: string;
  propertyTitle: string;
  /** City + address (manager / summary). */
  propertyAddress: string;
  /** Property.address column only (staff checklist). */
  streetAddress: string;
  reservationId: string | null;
  contextLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string;
  dueTime: string | null;
  notes: string;
  issueDescription: string | null;
  photoUrls: string[];
  hasVerificationPhoto: boolean;
  inProgressStartedAt: string | null;
  lastManagerSeenAt: string | null;
  unseenNotesCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface TaskNoteDto {
  uuid: string;
  taskId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl: string | null;
  createdAt: string;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(TaskNoteEntity)
    private readonly taskNoteRepo: Repository<TaskNoteEntity>,
    private readonly tasksGateway: TasksGateway,
  ) {}

  private toDto(
    t: TaskEntity,
    extras: { unseenNotesCount: number },
  ): TaskDto {
    const addr = [t.property.city, t.property.address].filter(Boolean).join(', ');
    return {
      uuid: t.id,
      type: t.type,
      status: t.status,
      priority: t.priority,
      propertyId: t.propertyId,
      propertyTitle: t.property.name,
      propertyAddress: addr,
      streetAddress: t.property.address,
      reservationId: t.reservationId,
      contextLabel: t.contextLabel,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee
        ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim()
        : null,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      notes: t.notes,
      issueDescription: t.issueDescription,
      photoUrls: t.photoUrls ?? [],
      hasVerificationPhoto: t.hasVerificationPhoto ?? false,
      inProgressStartedAt: t.inProgressStartedAt ? t.inProgressStartedAt.toISOString() : null,
      lastManagerSeenAt: t.lastManagerSeenAt ? t.lastManagerSeenAt.toISOString() : null,
      unseenNotesCount: extras.unseenNotesCount,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    };
  }

  private async unseenNoteCounts(taskIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (taskIds.length === 0) return map;
    const rows = (await this.taskRepo.manager.query(
      `SELECT t.id AS "taskId",
        (SELECT COUNT(*)::int FROM task_notes n
         WHERE n."taskId" = t.id
         AND n."createdAt" > COALESCE(t."lastManagerSeenAt", '1970-01-01'::timestamptz)) AS unseen
      FROM tasks t WHERE t.id = ANY($1::uuid[])`,
      [taskIds],
    )) as { taskId: string; unseen: string }[];
    for (const r of rows) {
      map.set(r.taskId, Number(r.unseen));
    }
    return map;
  }

  async findForUser(
    userId: string,
    from: string,
    to: string,
    assigneeId?: string,
  ): Promise<TaskDto[]> {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.property', 'p')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .where('p.ownerId = :userId', { userId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to });

    if (assigneeId && assigneeId !== 'all') {
      qb.andWhere('t.assigneeId = :assigneeId', { assigneeId });
    }

    const rows = await qb.orderBy('t.dueDate', 'ASC').addOrderBy('t.dueTime', 'ASC').getMany();
    const unseen = await this.unseenNoteCounts(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, { unseenNotesCount: unseen.get(r.id) ?? 0 }));
  }

  async findForStaff(userId: string, from: string, to: string): Promise<TaskDto[]> {
    const rows = await this.taskRepo
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.property', 'p')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .where('t.assigneeId = :userId', { userId })
      .andWhere('t.dueDate BETWEEN :from AND :to', { from, to })
      .orderBy('t.dueDate', 'ASC')
      .addOrderBy('t.dueTime', 'ASC')
      .getMany();
    return rows.map((r) => this.toDto(r, { unseenNotesCount: 0 }));
  }

  async ensureTaskAccess(taskId: string, userId: string, role: string): Promise<TaskEntity> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['property', 'assignee'],
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (role === 'STAFF') {
      if (task.assigneeId !== userId) {
        throw new ForbiddenException('You are not assigned to this task');
      }
    } else {
      if (task.property.ownerId !== userId) {
        throw new ForbiddenException();
      }
    }
    return task;
  }

  async update(
    taskId: string,
    userId: string,
    role: string,
    patch: Partial<{
      status: string;
      assigneeId: string | null;
      notes: string;
      issueDescription: string | null;
    }>,
  ): Promise<TaskDto> {
    const task = await this.ensureTaskAccess(taskId, userId, role);

    if (patch.status !== undefined) task.status = patch.status;
    if (patch.assigneeId !== undefined && role !== 'STAFF') task.assigneeId = patch.assigneeId;
    if (patch.notes !== undefined) task.notes = patch.notes;
    if (patch.issueDescription !== undefined) task.issueDescription = patch.issueDescription;

    if (patch.status === 'in_progress') {
      task.inProgressStartedAt = new Date();
    } else if (patch.status !== undefined) {
      task.inProgressStartedAt = null;
    }

    if (patch.status === 'done') {
      task.completedAt = new Date();
    } else if (patch.status && patch.status !== 'done') {
      task.completedAt = null;
    }

    await this.taskRepo.save(task);

    const reloaded = await this.reloadTask(task.id);
    this.tasksGateway.emitTaskUpdated({ uuid: reloaded.id, status: reloaded.status });
    return this.toDtoForRole(reloaded, role);
  }

  private async reloadTask(id: string): Promise<TaskEntity> {
    const t = await this.taskRepo.findOne({
      where: { id },
      relations: ['property', 'assignee'],
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  private async toDtoForRole(t: TaskEntity, role: string): Promise<TaskDto> {
    const unseen =
      role === 'STAFF' ? 0 : (await this.unseenNoteCounts([t.id])).get(t.id) ?? 0;
    return this.toDto(t, { unseenNotesCount: unseen });
  }

  async appendPhotoUrls(taskId: string, userId: string, role: string, urls: string[]): Promise<TaskDto> {
    const task = await this.ensureTaskAccess(taskId, userId, role);
    task.photoUrls = [...(task.photoUrls ?? []), ...urls];
    if (task.status === 'done') {
      task.hasVerificationPhoto = true;
    }
    await this.taskRepo.save(task);

    const reloaded = await this.reloadTask(task.id);
    this.tasksGateway.emitTaskUpdated({ uuid: reloaded.id, status: reloaded.status });
    return this.toDtoForRole(reloaded, role);
  }

  async listNotes(taskId: string, userId: string, role: string): Promise<TaskNoteDto[]> {
    await this.ensureTaskAccess(taskId, userId, role);
    const notes = await this.taskNoteRepo.find({
      where: { taskId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
    return notes.map((n) => ({
      uuid: n.id,
      taskId: n.taskId,
      authorId: n.authorId,
      authorName: `${n.author.firstName} ${n.author.lastName}`.trim(),
      text: n.text,
      photoUrl: n.photoUrl,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async addNote(
    taskId: string,
    userId: string,
    role: string,
    text: string,
    photoUrl: string | null,
  ): Promise<TaskNoteDto> {
    if (role !== 'STAFF') {
      throw new ForbiddenException('Only staff can add task notes');
    }
    const task = await this.ensureTaskAccess(taskId, userId, role);
    const row = this.taskNoteRepo.create({
      taskId: task.id,
      authorId: userId,
      text: text.trim(),
      photoUrl: photoUrl ?? null,
    });
    const saved = await this.taskNoteRepo.save(row);
    const withAuthor = await this.taskNoteRepo.findOne({
      where: { id: saved.id },
      relations: ['author'],
    });
    if (!withAuthor) throw new NotFoundException();

    this.tasksGateway.emitTaskNoteAdded({
      taskId: task.id,
      propertyOwnerId: task.property.ownerId,
    });

    return {
      uuid: withAuthor.id,
      taskId: withAuthor.taskId,
      authorId: withAuthor.authorId,
      authorName: `${withAuthor.author.firstName} ${withAuthor.author.lastName}`.trim(),
      text: withAuthor.text,
      photoUrl: withAuthor.photoUrl,
      createdAt: withAuthor.createdAt.toISOString(),
    };
  }

  async markManagerSeenRole(taskId: string, userId: string, role: string): Promise<TaskDto> {
    if (role !== 'OWNER' && role !== 'MANAGER') {
      throw new ForbiddenException();
    }
    const task = await this.ensureTaskAccess(taskId, userId, role);
    task.lastManagerSeenAt = new Date();
    await this.taskRepo.save(task);
    const reloaded = await this.reloadTask(task.id);
    return this.toDtoForRole(reloaded, role);
  }

  async seedDemoIfEmpty(userId: string): Promise<void> {
    const count = await this.taskRepo.count();
    if (count > 0) return;

    const props = await this.taskRepo.manager.query(
      `SELECT id FROM properties WHERE "ownerId" = $1 LIMIT 2`,
      [userId],
    );
    if (!props?.length) return;

    const today = format(new Date(), 'yyyy-MM-dd');
    const rows: Partial<TaskEntity>[] = [
      {
        type: 'checkout_cleaning',
        status: 'pending',
        priority: 'urgent',
        propertyId: props[0].id,
        reservationId: null,
        contextLabel: 'Выезд 12:00 → Заезд 15:00. Окно: 3ч',
        assigneeId: null,
        dueDate: today,
        dueTime: '14:00',
        notes: '',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: null,
      },
      {
        type: 'checkin_prep',
        status: 'pending',
        priority: 'normal',
        propertyId: props[0].id,
        reservationId: null,
        contextLabel: 'Заезд гостя 16:00',
        assigneeId: null,
        dueDate: today,
        dueTime: '15:00',
        notes: '',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: null,
      },
    ];

    if (props[1]) {
      rows.push({
        type: 'manual',
        status: 'in_progress',
        priority: 'low',
        propertyId: props[1].id,
        reservationId: null,
        contextLabel: null,
        assigneeId: null,
        dueDate: today,
        dueTime: null,
        notes: 'Ручная задача',
        issueDescription: null,
        photoUrls: [],
        hasVerificationPhoto: false,
        completedAt: null,
        lastManagerSeenAt: null,
        inProgressStartedAt: new Date(),
      });
    }

    for (const r of rows) {
      await this.taskRepo.save(this.taskRepo.create(r));
    }
  }
}
