import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import type { PublicUser, StaffMemberDto } from './interfaces/public-user.interface';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(input: CreateUserInput): Promise<UserEntity> {
    const user = this.userRepository.create({
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? 'OWNER',
    });
    return this.userRepository.save(user);
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  toPublicUser(user: UserEntity): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      role: user.role,
      language: user.language,
      telegramChatId: user.telegramChatId ?? null,
      employerOwnerId: user.employerOwnerId ?? null,
      staffShiftCompletedAt: user.staffShiftCompletedAt
        ? user.staffShiftCompletedAt.toISOString()
        : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Returns all STAFF/MANAGER users that belong to the given owner account.
   * Falls back to users who have ever been assigned a task on any of owner's properties
   * (for backward compatibility with accounts created before tenant linking was introduced).
   */
  async findStaffByOwner(ownerId: string): Promise<StaffMemberDto[]> {
    const rows = await this.dataSource.query<
      { id: string; firstName: string; lastName: string; role: string }[]
    >(
      `SELECT DISTINCT u.id, u."firstName", u."lastName", u.role
       FROM users u
       WHERE u.role IN ('STAFF', 'MANAGER')
         AND (
           u."employerOwnerId" = $1
           OR EXISTS (
             SELECT 1 FROM tasks t
             JOIN properties p ON t."propertyId" = p.id
             WHERE t."assigneeId" = u.id
               AND p."ownerId" = $1
           )
         )
       ORDER BY u."firstName", u."lastName"`,
      [ownerId],
    );

    return rows.map((r) => ({
      id: r.id,
      displayName: `${r.firstName} ${r.lastName}`.trim(),
      role: r.role,
    }));
  }

  async markStaffShiftComplete(userId: string): Promise<PublicUser> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'STAFF') {
      throw new ForbiddenException('Only staff can complete shift');
    }
    user.staffShiftCompletedAt = new Date();
    const saved = await this.userRepository.save(user);
    return this.toPublicUser(saved);
  }

  async updateTelegramChatId(userId: string, telegramChatId: string | null): Promise<PublicUser> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    user.telegramChatId = telegramChatId ?? undefined;
    const saved = await this.userRepository.save(user);
    return this.toPublicUser(saved);
  }

  async getPublicProfileById(id: string): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) {
      this.logger.warn(`Profile requested for missing user: ${id}`);
      throw new NotFoundException('User not found');
    }
    return this.toPublicUser(user);
  }
}
