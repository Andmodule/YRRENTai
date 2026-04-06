import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KnowledgeBaseService } from './knowledge-base.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { KbStatus } from './entities/knowledge-base-entry.entity';

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly configService: ConfigService,
  ) {}

  private assertDevKbClearAllowed(): void {
    const env = this.configService.get<string>('NODE_ENV');
    const flag = this.configService.get<string>('KB_DEV_ALLOW_CLEAR')?.toLowerCase();
    const allowFlag = flag === 'true' || flag === '1' || flag === 'yes';
    if (env !== 'development' && !allowFlag) {
      throw new ForbiddenException('Knowledge base dev clear is disabled');
    }
  }

  @Get(':propertyId')
  @Roles('OWNER', 'MANAGER')
  async findAll(
    @Param('propertyId') propertyId: string,
    @Query('status') status?: string,
  ) {
    const entries = await this.kbService.findAllWithStatus(propertyId, status as KbStatus);
    return { data: entries };
  }

  @Post(':propertyId')
  @Roles('OWNER', 'MANAGER')
  async create(
    @Param('propertyId') propertyId: string,
    @Body() body: { title: string; content: string; category?: string },
  ) {
    const entry = await this.kbService.create(propertyId, body);
    return { data: entry };
  }

  @Patch(':propertyId/:id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; category?: string; status?: KbStatus },
  ) {
    const entry = await this.kbService.update(id, body);
    return { data: entry };
  }

  @Delete(':propertyId/:id')
  @Roles('OWNER', 'MANAGER')
  async remove(@Param('id') id: string) {
    await this.kbService.remove(id);
    return { data: null };
  }

  @Post(':propertyId/backfill-embeddings')
  @Roles('OWNER', 'MANAGER')
  async backfill(@Param('propertyId') propertyId: string) {
    const result = await this.kbService.backfillEmbeddings(propertyId);
    return { data: result };
  }

  /** Local/staging only: delete every KB row for this property. Requires NODE_ENV=development or KB_DEV_ALLOW_CLEAR=true */
  @Post(':propertyId/dev/clear-all')
  @Roles('OWNER', 'MANAGER')
  async devClearAll(@Param('propertyId') propertyId: string) {
    this.assertDevKbClearAllowed();
    const result = await this.kbService.removeAllForProperty(propertyId);
    return { data: result };
  }
}
