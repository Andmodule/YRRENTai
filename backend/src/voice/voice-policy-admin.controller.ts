import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PropertyVoicePolicyService } from './property-voice-policy.service';

const upsertVoicePolicySchema = z.object({
  voiceAssistantEnabled: z.boolean().optional(),
  autoAnswerEnabled: z.boolean().optional(),
  recordCallsEnabled: z.boolean().optional(),
  clarifyThreshold: z.number().min(0).max(1).optional(),
  escalateThreshold: z.number().min(0).max(1).optional(),
  maxTurns: z.number().int().min(1).max(50).optional(),
  fallbackTransferNumber: z.string().nullable().optional(),
  afterHoursMode: z.enum(['voicemail', 'transfer', 'short_ai', 'reject']).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  emergencyEscalationEnabled: z.boolean().optional(),
  complaintAutoEscalate: z.boolean().optional(),
  preferredLanguages: z.string().max(64).optional(),
  shortAnswerMode: z.boolean().optional(),
  allowedTopics: z.string().nullable().optional(),
  escalationTopics: z.string().nullable().optional(),
  customFallbackPhrases: z.record(z.array(z.string())).nullable().optional(),
});

class UpsertVoicePolicyDto extends createZodDto(upsertVoicePolicySchema) {}

@ApiTags('Voice Policy')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/policy')
export class VoicePolicyAdminController {
  constructor(private readonly policyService: PropertyVoicePolicyService) {}

  @Get(':propertyId')
  @ApiOperation({ summary: 'Get voice policy for a property' })
  async getPolicy(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    const policy = await this.policyService.getOrCreatePolicy(propertyId);
    return { data: policy };
  }

  @Put(':propertyId')
  @ApiOperation({ summary: 'Upsert voice policy for a property' })
  async upsertPolicy(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpsertVoicePolicyDto,
  ) {
    const policy = await this.policyService.upsert(propertyId, dto);
    return { data: policy };
  }
}
