import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import type { PublicUser } from './interfaces/public-user.interface';

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
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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
