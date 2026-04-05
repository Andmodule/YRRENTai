import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnmappedReportEntity } from './entities/unmapped-report.entity';
import { UserService } from '../user/user.service';
import { TasksService } from '../tasks/tasks.service';

export interface UnmappedReportDto {
  id: string;
  userId: string;
  staffName: string;
  photoUrl: string | null;
  transcript: string | null;
  createdAt: string;
}

@Injectable()
export class UnmappedReportsService {
  constructor(
    @InjectRepository(UnmappedReportEntity)
    private readonly unmappedRepo: Repository<UnmappedReportEntity>,
    private readonly userService: UserService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {}

  async listForTenant(ownerId: string): Promise<UnmappedReportDto[]> {
    const rows = await this.unmappedRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.user', 'u')
      .where('u.employerOwnerId = :ownerId', { ownerId })
      .andWhere('u.role = :role', { role: 'STAFF' })
      .orderBy('r.createdAt', 'DESC')
      .take(200)
      .getMany();

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      staffName: `${r.user.firstName} ${r.user.lastName}`.trim(),
      photoUrl: r.photoUrl,
      transcript: r.transcript,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async countForTenant(ownerId: string): Promise<number> {
    return this.unmappedRepo
      .createQueryBuilder('r')
      .innerJoin('r.user', 'u')
      .where('u.employerOwnerId = :ownerId', { ownerId })
      .andWhere('u.role = :role', { role: 'STAFF' })
      .getCount();
  }

  /**
   * Attach photo and/or transcript from an unmapped report to an existing task (manager triage).
   */
  async attachToTask(
    reportId: string,
    taskId: string,
    actingUserId: string,
    actingRole: string,
  ): Promise<{ ok: true }> {
    const ownerId = await this.userService.resolveTenantOwnerId(actingUserId, actingRole);
    const report = await this.unmappedRepo.findOne({
      where: { id: reportId },
      relations: ['user'],
    });
    if (!report || report.user.employerOwnerId !== ownerId || report.user.role !== 'STAFF') {
      throw new NotFoundException();
    }

    if (report.photoUrl?.trim()) {
      await this.tasksService.appendPhotoUrls(taskId, ownerId, 'MANAGER', [report.photoUrl.trim()]);
    }

    if (report.transcript?.trim()) {
      const taskDto = await this.tasksService.getOneForUser(taskId, ownerId, 'MANAGER');
      const prev = taskDto.notes?.trim() ?? '';
      const add = `${prev ? `${prev}\n\n` : ''}[Telegram, ${report.user.firstName}] ${report.transcript.trim()}`;
      await this.tasksService.update(taskId, ownerId, 'MANAGER', { notes: add });
    }

    if (!report.photoUrl?.trim() && !report.transcript?.trim()) {
      throw new ForbiddenException('Empty report');
    }

    await this.unmappedRepo.delete({ id: report.id });
    return { ok: true };
  }

  async dismiss(reportId: string, actingUserId: string, actingRole: string): Promise<{ ok: true }> {
    const ownerId = await this.userService.resolveTenantOwnerId(actingUserId, actingRole);
    const report = await this.unmappedRepo.findOne({
      where: { id: reportId },
      relations: ['user'],
    });
    if (!report || report.user.employerOwnerId !== ownerId || report.user.role !== 'STAFF') {
      throw new NotFoundException();
    }
    await this.unmappedRepo.delete({ id: report.id });
    return { ok: true };
  }
}
