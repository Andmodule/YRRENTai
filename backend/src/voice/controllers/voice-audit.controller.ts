import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { VoiceAuditService } from '../voice-audit.service';
import type { AuditActionType } from '../entities/voice-audit-log.entity';

@ApiTags('Voice — Audit')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice/audit-log')
export class VoiceAuditController {
  constructor(private readonly auditService: VoiceAuditService) {}

  @Get()
  @ApiOperation({ summary: 'Read-only voice audit log with filters and pagination' })
  @ApiQuery({ name: 'actionType',  required: false })
  @ApiQuery({ name: 'actorId',     required: false })
  @ApiQuery({ name: 'propertyId',  required: false })
  @ApiQuery({ name: 'dateFrom',    required: false })
  @ApiQuery({ name: 'dateTo',      required: false })
  @ApiQuery({ name: 'page',        required: false })
  @ApiQuery({ name: 'pageSize',    required: false })
  async getAuditLog(
    @Query('actionType')  actionType?: string,
    @Query('actorId')     actorId?: string,
    @Query('propertyId')  propertyId?: string,
    @Query('dateFrom')    dateFrom?: string,
    @Query('dateTo')      dateTo?: string,
    @Query('page')        page = '0',
    @Query('pageSize')    pageSize = '50',
  ) {
    return {
      data: await this.auditService.getAuditLog({
        actionType: actionType as AuditActionType | undefined,
        actorId,
        propertyId,
        dateFrom,
        dateTo,
        page:     Number(page),
        pageSize: Math.min(Number(pageSize), 200),
      }),
    };
  }
}
