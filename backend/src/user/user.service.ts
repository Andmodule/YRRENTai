import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UserEntity } from './entities/user.entity';
import { StaffInviteTokenEntity } from './entities/staff-invite-token.entity';
import { CompanyEntity } from './entities/company.entity';
import type {
  PublicUser,
  StaffMemberDto,
  StaffDirectoryRowDto,
  StaffInviteCreatedDto,
  StaffPersonnelPayloadDto,
} from './interfaces/public-user.interface';

const STAFF_INVITE_BCRYPT_ROUNDS = 12;

const INVITE_LINK_INVALID =
  '❌ Срок действия ссылки истёк или она уже использована. Попросите управляющего новую.';
const TELEGRAM_CHAT_COLLISION =
  '⚠️ Этот Telegram-аккаунт уже привязан к другому профилю.';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: string;
  companyId?: string | null;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(StaffInviteTokenEntity)
    private readonly staffInviteTokenRepository: Repository<StaffInviteTokenEntity>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async create(input: CreateUserInput): Promise<UserEntity> {
    const user = this.userRepository.create({
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? 'OWNER',
      companyId: input.companyId ?? null,
    });
    return this.userRepository.save(user);
  }

  /** Self-service SaaS: new company + first OWNER in one transaction. */
  async registerOwnerWithCompany(input: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    companyName: string;
  }): Promise<UserEntity> {
    return this.dataSource.transaction(async (em) => {
      const companyName = input.companyName
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 255);
      if (!companyName.length) {
        throw new BadRequestException('Company name is required');
      }
      const company = em.create(CompanyEntity, { name: companyName });
      const savedCompany = await em.save(CompanyEntity, company);
      const user = em.create(UserEntity, {
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'OWNER',
        companyId: savedCompany.id,
      });
      return em.save(UserEntity, user);
    });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findByTelegramChatId(chatId: string): Promise<UserEntity | null> {
    const trimmed = chatId.trim();
    if (!trimmed) return null;
    return this.userRepository.findOne({ where: { telegramChatId: trimmed } });
  }

  /**
   * Links Telegram chat to staff user after valid invite token; marks token used.
   */
  async bindStaffTelegramFromInvite(
    chatId: string,
    rawToken: string,
  ): Promise<{ ok: true; firstName: string } | { ok: false; message: string }> {
    const token = rawToken.trim();
    if (!token) {
      return { ok: false, message: INVITE_LINK_INVALID };
    }
    const found = await this.findStaffInviteByToken(token);
    if (!found) {
      return { ok: false, message: INVITE_LINK_INVALID };
    }
    const { invite, user } = found;
    if (invite.isUsed || invite.expiresAt.getTime() < Date.now()) {
      return { ok: false, message: INVITE_LINK_INVALID };
    }
    if (user.role !== 'STAFF') {
      return { ok: false, message: 'Ошибка профиля.' };
    }

    const other = await this.userRepository.findOne({
      where: { telegramChatId: chatId.trim() },
    });
    if (other && other.id !== user.id) {
      return { ok: false, message: TELEGRAM_CHAT_COLLISION };
    }

    try {
      await this.dataSource.transaction(async (em) => {
        await em.update(
          UserEntity,
          { id: user.id },
          { telegramChatId: chatId.trim() },
        );
        await em.update(
          StaffInviteTokenEntity,
          { id: invite.id },
          { isUsed: true },
        );
      });
    } catch (e) {
      if (e instanceof QueryFailedError) {
        const code = (e as unknown as { driverError?: { code?: string } }).driverError?.code;
        if (code === '23505') {
          return { ok: false, message: TELEGRAM_CHAT_COLLISION };
        }
      }
      throw e;
    }

    const fresh = await this.findById(user.id);
    return { ok: true, firstName: fresh?.firstName ?? user.firstName };
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
      companyId: user.companyId ?? null,
      companyName: user.company?.name ?? null,
      employerOwnerId: user.employerOwnerId ?? null,
      staffJobType: user.staffJobType ?? null,
      telegramUsername: user.telegramUsername ?? null,
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
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['company'],
    });
    if (!user) {
      this.logger.warn(`Profile requested for missing user: ${id}`);
      throw new NotFoundException('User not found');
    }
    return this.toPublicUser(user);
  }

  /**
   * Resolves the tenant owner UUID for OWNER (self) or MANAGER/STAFF (`employerOwnerId`).
   */
  async resolveTenantOwnerId(userId: string, role: string): Promise<string> {
    if (role === 'OWNER') {
      return userId;
    }
    if (role === 'MANAGER' || role === 'STAFF') {
      const user = await this.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (!user.employerOwnerId) {
        throw new ForbiddenException(
          role === 'MANAGER'
            ? 'Manager is not linked to an owner account'
            : 'Staff is not linked to an owner account',
        );
      }
      return user.employerOwnerId;
    }
    throw new ForbiddenException('Not allowed');
  }

  /** Tenant UUID for row-level scoping; null for SUPERADMIN (full platform access). */
  async resolveCompanyId(userId: string, role: string): Promise<string | null> {
    if (role === 'SUPERADMIN') {
      return null;
    }
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.companyId) {
      throw new ForbiddenException('No company context for this account');
    }
    return user.companyId;
  }

  /**
   * STAFF users for this tenant (strict `employerOwnerId` match).
   */
  async findStaffDirectoryForTenant(tenantOwnerId: string): Promise<StaffPersonnelPayloadDto> {
    const botRaw = this.configService.get<string>('TELEGRAM_BOT_USERNAME')?.trim();
    const telegramBotConfigured = !!botRaw?.replace(/^@/, '');

    const rows = await this.userRepository.find({
      where: { role: 'STAFF', employerOwnerId: tenantOwnerId },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    const members: StaffDirectoryRowDto[] = rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone?.trim() ? u.phone.trim() : null,
      jobType: u.staffJobType ?? null,
      telegramUsername: u.telegramUsername?.trim() ? u.telegramUsername.trim() : null,
      telegramLinked: !!u.telegramChatId?.trim(),
      createdAt: u.createdAt.toISOString(),
    }));

    return { members, telegramBotConfigured };
  }

  /**
   * Creates a STAFF user with contact data; optional 24h Telegram invite when bot username is configured.
   */
  async createStaffInviteAndUser(
    tenantOwnerId: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      jobType: 'cleaner' | 'maintenance' | 'driver' | 'other';
      telegramUsername?: string;
    },
  ): Promise<StaffInviteCreatedDto> {
    const emailNorm = input.email.trim().toLowerCase();
    const dup = await this.findByEmail(emailNorm);
    if (dup) {
      throw new ConflictException('Email already registered');
    }

    const botRaw = this.configService.get<string>('TELEGRAM_BOT_USERNAME')?.trim();
    const normalizedBot = botRaw?.replace(/^@/, '') ?? '';
    const telegramBotConfigured = normalizedBot.length > 0;

    const owner = await this.findById(tenantOwnerId);
    if (!owner?.companyId) {
      throw new BadRequestException('Owner company not found');
    }
    const companyId = owner.companyId;

    const passwordHash = await bcrypt.hash(randomUUID(), STAFF_INVITE_BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const phoneVal = input.phone?.trim();
    const tgUser = input.telegramUsername?.trim() ?? null;

    let savedUser: UserEntity;
    if (telegramBotConfigured) {
      const tokenStr = randomUUID();
      savedUser = await this.dataSource.transaction(async (em) => {
        const user = em.create(UserEntity, {
          email: emailNorm,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: phoneVal || undefined,
          role: 'STAFF',
          employerOwnerId: tenantOwnerId,
          companyId,
          staffJobType: input.jobType,
          telegramUsername: tgUser,
        });
        const su = await em.save(UserEntity, user);
        const inviteRow = em.create(StaffInviteTokenEntity, {
          token: tokenStr,
          userId: su.id,
          expiresAt,
          isUsed: false,
        });
        await em.save(inviteRow);
        return su;
      });
      const inviteLink = `https://t.me/${normalizedBot}?start=${tokenStr}`;
      this.logger.log(`Staff + invite created for user ${savedUser.id} (owner ${tenantOwnerId})`);
      return {
        userId: savedUser.id,
        inviteLink,
        expiresAt: expiresAt.toISOString(),
        telegramBotConfigured: true,
      };
    }

    savedUser = await this.userRepository.save(
      this.userRepository.create({
        email: emailNorm,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: phoneVal || undefined,
        role: 'STAFF',
        employerOwnerId: tenantOwnerId,
        companyId,
        staffJobType: input.jobType,
        telegramUsername: tgUser,
      }),
    );
    this.logger.log(`Staff created (no bot invite) for user ${savedUser.id} (owner ${tenantOwnerId})`);
    return {
      userId: savedUser.id,
      inviteLink: null,
      expiresAt: null,
      telegramBotConfigured: false,
    };
  }

  /**
   * Used by bot `/start` (Phase 1): load invite by raw token string.
   */
  async findStaffInviteByToken(
    token: string,
  ): Promise<{ invite: StaffInviteTokenEntity; user: UserEntity } | null> {
    const trimmed = token.trim();
    if (!trimmed) {
      return null;
    }
    const invite = await this.staffInviteTokenRepository.findOne({
      where: { token: trimmed },
      relations: ['user'],
    });
    if (!invite || !invite.user) {
      return null;
    }
    return { invite, user: invite.user };
  }
}
