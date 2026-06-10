import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiReplySettingsService {
  constructor(private readonly config: ConfigService) {}

  requiresApproval(): boolean {
    return this.config.get<boolean>('AI_REPLY_REQUIRES_APPROVAL') ?? false;
  }
}
