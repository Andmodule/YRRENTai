import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async sendEmail(_to: string, _subject: string, _body: string): Promise<void> {
    this.logger.log('Email notification stub');
  }

  async sendPush(_userId: string, _title: string, _body: string): Promise<void> {
    this.logger.log('Push notification stub');
  }
}
