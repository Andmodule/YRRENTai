import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { LoginDto as LoginDtoType, RegisterDto as RegisterDtoType } from '@rentai/shared';
import type { Response } from 'express';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UserService } from '../user/user.service';
import { UserEntity } from '../user/entities/user.entity';
import {
  ACCESS_TOKEN_COOKIE,
  AUTH_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE,
} from './constants/auth.constants';
import { parseDurationToMs } from './utils/parse-duration-to-ms';
import { validateTelegramWebAppInitData } from './utils/telegram-init-data';
import { resolveStaffTelegramBotToken } from '../telegram/telegram-staff-env';

const BCRYPT_ROUNDS = 12;

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  companyId?: string | null;
}

interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDtoType, res: Response) {
    const registrationOpen = this.configService.get<boolean>('AUTH_PUBLIC_REGISTRATION_ENABLED') ?? true;
    if (!registrationOpen) {
      throw new ForbiddenException('Registration is disabled');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.userService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.userService.registerOwnerWithCompany({
      email,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      companyName: dto.companyName.trim(),
    });

    await this.setAuthCookiesForUser(res, user);
    this.logger.log(`User registered: ${user.id} (company ${user.companyId})`);

    return { data: await this.userService.getPublicProfileById(user.id) };
  }

  async login(dto: LoginDtoType, res: Response) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.setAuthCookiesForUser(res, user);
    this.logger.log(`User logged in: ${user.id}`);

    return { data: await this.userService.getPublicProfileById(user.id) };
  }

  async refresh(req: { cookies?: Record<string, string> }, res: Response) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const secret = this.configService.get<string>('JWT_SECRET');
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.typ !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.role !== 'SUPERADMIN' && !user.companyId) {
      throw new UnauthorizedException('Session expired: invalid tenant context');
    }

    await this.setAuthCookiesForUser(res, user);
    return { data: await this.userService.getPublicProfileById(user.id) };
  }

  logout(res: Response) {
    this.clearAuthCookies(res);
    return { data: { ok: true as const } };
  }

  /**
   * Telegram Mini App: validate `initData`, resolve STAFF user by `telegramChatId`, issue JWT cookies.
   */
  async loginWithTelegramMiniApp(initData: string, res: Response) {
    const botToken = resolveStaffTelegramBotToken(this.configService);
    if (!botToken) {
      throw new UnauthorizedException(
        'Staff Telegram bot is not configured (TELEGRAM_STAFF_BOT_TOKEN or legacy TELEGRAM_BOT_TOKEN)',
      );
    }
    const v = validateTelegramWebAppInitData(initData, botToken);
    if (!v.ok) {
      throw new UnauthorizedException('Invalid or expired Telegram initData');
    }
    const chatId = String(v.telegramUserId);
    const user = await this.userService.findByTelegramChatId(chatId);
    if (!user || user.role !== 'STAFF') {
      throw new UnauthorizedException('Staff profile not linked to this Telegram account');
    }

    await this.setAuthCookiesForUser(res, user);
    this.logger.log(`TMA login: user ${user.id}`);
    return { data: await this.userService.getPublicProfileById(user.id) };
  }

  /**
   * Short-lived JWT for Socket.IO handshake when the client connects to the API host
   * (e.g. Render) while session cookies are scoped to the Next.js origin (e.g. Vercel).
   */
  async createWsHandshakeToken(user: JwtPayload): Promise<string> {
    const secret = this.configService.get<string>('JWT_SECRET');
    const payload: AccessTokenPayload = {
      sub: user.sub,
      email: user.email,
      role: user.role,
      companyId: user.companyId ?? null,
    };
    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: '5m',
    });
  }

  private getCookieBaseOptions() {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const crossSite = this.configService.get<boolean>('AUTH_COOKIE_CROSS_SITE');
    const sameSite = isProd && crossSite ? ('none' as const) : ('lax' as const);
    return {
      httpOnly: true,
      secure: isProd,
      sameSite,
      path: AUTH_COOKIE_PATH,
    };
  }

  private getCookieOptions(maxAgeMs: number) {
    return {
      ...this.getCookieBaseOptions(),
      maxAge: maxAgeMs,
    };
  }

  private clearAuthCookies(res: Response) {
    const opts = this.getCookieBaseOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, opts);
    res.clearCookie(REFRESH_TOKEN_COOKIE, opts);
  }

  private async setAuthCookiesForUser(res: Response, user: UserEntity) {
    const secret = this.configService.get<string>('JWT_SECRET');
    const accessExp = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    const refreshExp = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId ?? null,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret,
      expiresIn: accessExp,
    });

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      typ: 'refresh',
    };

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret,
      expiresIn: refreshExp,
    });

    const accessMs = parseDurationToMs(accessExp, 15 * 60 * 1000);
    const refreshMs = parseDurationToMs(refreshExp, 7 * 24 * 60 * 60 * 1000);

    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, this.getCookieOptions(accessMs));
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, this.getCookieOptions(refreshMs));
  }
}
