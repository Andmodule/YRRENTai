import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { LoginDto as LoginDtoType, RegisterDto as RegisterDtoType } from '@rentai/shared';
import type { Response } from 'express';
import { UserService } from '../user/user.service';
import { UserEntity } from '../user/entities/user.entity';
import {
  ACCESS_TOKEN_COOKIE,
  AUTH_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE,
} from './constants/auth.constants';
import { parseDurationToMs } from './utils/parse-duration-to-ms';

const BCRYPT_ROUNDS = 12;

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
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
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.userService.create({
      email,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });

    await this.setAuthCookiesForUser(res, user);
    this.logger.log(`User registered: ${user.id}`);

    return { data: this.userService.toPublicUser(user) };
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

    return { data: this.userService.toPublicUser(user) };
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

    await this.setAuthCookiesForUser(res, user);
    return { data: this.userService.toPublicUser(user) };
  }

  logout(res: Response) {
    this.clearAuthCookies(res);
    return { data: { ok: true as const } };
  }

  private getCookieOptions(maxAgeMs: number) {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: AUTH_COOKIE_PATH,
      maxAge: maxAgeMs,
    };
  }

  private clearAuthCookies(res: Response) {
    const opts = { httpOnly: true, secure: this.configService.get<string>('NODE_ENV') === 'production', sameSite: 'lax' as const, path: AUTH_COOKIE_PATH };
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
