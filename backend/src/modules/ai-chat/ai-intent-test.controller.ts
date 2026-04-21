import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { randomUUID } from 'crypto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PropertyService } from '../../property/property.service';
import { AiExtractorService } from './ai-extractor.service';
import { AiIntentTestBodyDto } from './dto/ai-intent-test.dto';
import type { ChatMessageSavedEvent } from './events/chat-message-saved.event';

@ApiTags('AI Chat (testing)')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('ai-chat')
export class AiIntentTestController {
  constructor(
    private readonly configService: ConfigService,
    private readonly aiExtractorService: AiExtractorService,
    private readonly propertyService: PropertyService,
  ) {}

  private assertIntentTestingAllowed(): void {
    const env = this.configService.get<string>('NODE_ENV');
    const flag = this.configService.get<string>('AI_INTENT_TESTING_ALLOW')?.toLowerCase();
    const allowFlag = flag === 'true' || flag === '1' || flag === 'yes';
    if (env !== 'development' && !allowFlag) {
      throw new ForbiddenException(
        'AI intent testing is allowed only in NODE_ENV=development or when AI_INTENT_TESTING_ALLOW=true',
      );
    }
  }

  @Get('test-intent/examples')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Sample messages for POST /ai-chat/test-intent (copy into body.text)',
  })
  examples(): {
    data: Array<{
      id: string;
      label: string;
      senderRole: ChatMessageSavedEvent['senderRole'];
      text: string;
    }>;
  } {
    this.assertIntentTestingAllowed();
    return {
      data: [
        {
          id: 'cleaner_delayed',
          label: 'Уборка — задержка (staff)',
          senderRole: 'STAFF',
          text: 'Задержусь на уборке примерно на 40 минут, лифт долго ехал',
        },
        {
          id: 'maintenance_wifi',
          label: 'Поломка — Wi‑Fi',
          senderRole: 'GUEST',
          text: 'Интернет не работает, роутер мигает красным уже час',
        },
        {
          id: 'faq_wifi',
          label: 'FAQ — пароль Wi‑Fi',
          senderRole: 'GUEST',
          text: 'Подскажите пароль от Wi‑Fi и название сети, пожалуйста',
        },
        {
          id: 'late_checkout',
          label: 'Поздний выезд',
          senderRole: 'GUEST',
          text: 'Можно ли выехать в 14:00 вместо 11:00? Готов доплатить',
        },
        {
          id: 'early_checkin',
          label: 'Ранний заезд',
          senderRole: 'GUEST',
          text: 'Приеду в 12:00, можно зайти пораньше?',
        },
        {
          id: 'luggage',
          label: 'Хранение багажа',
          senderRole: 'GUEST',
          text: 'Можно оставить чемоданы у вас после выезда до вечера?',
        },
        {
          id: 'faq_parking',
          label: 'FAQ — парковка',
          senderRole: 'GUEST',
          text: 'Где гостям парковаться и бесплатно ли?',
        },
        {
          id: 'none_smalltalk',
          label: 'NONE — мелочь',
          senderRole: 'GUEST',
          text: 'Спасибо большое, всё супер!',
        },
      ],
    };
  }

  @Post('test-intent')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'SUPERADMIN')
  @ApiOperation({
    summary:
      'Dry-run: same LLM + Zod as the Bull worker; does not save chat or emit ai.intent.detected. Dev or AI_INTENT_TESTING_ALLOW.',
  })
  async testIntent(
    @CurrentUser() user: JwtPayload,
    @Body() body: AiIntentTestBodyDto,
  ): Promise<{ data: Awaited<ReturnType<AiExtractorService['dryRunIntentExtraction']>> }> {
    this.assertIntentTestingAllowed();
    await this.propertyService.findOneForUser(body.propertyId, user.sub, user.role);

    const payload: ChatMessageSavedEvent = {
      messageId: randomUUID(),
      propertyId: body.propertyId,
      senderId: body.senderId?.trim() || `intent-preview:${user.sub}`,
      senderRole: body.senderRole,
      text: body.text,
      channel: body.channel ?? 'web',
    };

    const data = await this.aiExtractorService.dryRunIntentExtraction(payload, {
      skipActiveRulesGate: body.skipActiveRulesGate ?? true,
    });
    return { data };
  }
}
