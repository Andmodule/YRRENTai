import {
  Controller,
  Post,
  Body,
  Param,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KnowledgeBaseImportService, KbImportDraft } from './knowledge-base-import.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Knowledge Base Import')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('knowledge-base')
export class KnowledgeBaseImportController {
  constructor(private readonly importService: KnowledgeBaseImportService) {}

  @Post(':propertyId/import/file')
  @Roles('OWNER', 'MANAGER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  async importFile(
    @Param('propertyId') _propertyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const mime = file.mimetype;
    if (!this.importService.isSupportedMime(mime)) {
      throw new BadRequestException(
        `Unsupported file type: ${mime}. Supported: PDF, DOCX, TXT, MD`,
      );
    }

    const text = await this.importService.extractTextFromBuffer(file.buffer, mime);
    const drafts = await this.importService.parseToEntries(text);

    return { data: { drafts, total: drafts.length } };
  }

  @Post(':propertyId/import/url')
  @Roles('OWNER', 'MANAGER')
  async importUrl(
    @Param('propertyId') _propertyId: string,
    @Body() body: { url: string },
  ) {
    if (!body.url) {
      throw new BadRequestException('url is required');
    }

    const text = await this.importService.extractTextFromUrl(body.url);
    const drafts = await this.importService.parseToEntries(text);

    return { data: { drafts, total: drafts.length } };
  }

  @Post(':propertyId/import/confirm')
  @Roles('OWNER', 'MANAGER')
  async confirmImport(
    @Param('propertyId') propertyId: string,
    @Body() body: { drafts: KbImportDraft[] },
  ) {
    if (!Array.isArray(body.drafts) || body.drafts.length === 0) {
      throw new BadRequestException('drafts must be a non-empty array');
    }

    const saved = await this.importService.confirmDrafts(propertyId, body.drafts);
    return { data: { saved: saved.length } };
  }
}
