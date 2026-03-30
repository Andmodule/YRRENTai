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
} from '@nestjs/common';
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
  constructor(private readonly kbService: KnowledgeBaseService) {}

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
}
