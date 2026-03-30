import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribe() {
    const provider = this.configService.get<string>('VOICE_PROVIDER', 'google');
    this.logger.log(`Voice transcription via ${provider}`);
    return { data: { text: '', provider } };
  }
}
