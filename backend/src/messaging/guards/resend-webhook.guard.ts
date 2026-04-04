import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Webhook } from 'svix';

@Injectable()
export class ResendWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (!secret?.trim()) {
      if (nodeEnv === 'production') {
        throw new UnauthorizedException('RESEND_WEBHOOK_SECRET is required in production');
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new UnauthorizedException('Missing raw body for webhook verification');
    }

    const wh = new Webhook(secret);
    try {
      wh.verify(raw, {
        'svix-id': req.headers['svix-id'] as string,
        'svix-timestamp': req.headers['svix-timestamp'] as string,
        'svix-signature': req.headers['svix-signature'] as string,
      });
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }
  }
}
