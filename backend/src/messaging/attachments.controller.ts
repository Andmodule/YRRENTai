import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserService } from '../user/user.service';
import { StorageService } from '../modules/storage/storage.service';
import { MessagingAttachmentEntity } from './entities/messaging_attachments.entity';

@ApiTags('Messaging')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('messages/attachments')
export class AttachmentsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly userService: UserService,
    @InjectRepository(MessagingAttachmentEntity)
    private readonly attachmentRepo: Repository<MessagingAttachmentEntity>,
  ) {}

  @Get(':id/download')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Download attachment via short-lived presigned URL (redirect)',
    description:
      'Verifies tenant ownership of the attachment, then redirects to a temporary R2/S3 presigned GET URL.',
  })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const ownerId = await this.userService.resolveTenantOwnerId(user.sub, user.role);
    const attachment = await this.attachmentRepo.findOne({
      where: { id },
      relations: ['message', 'message.thread'],
    });
    if (!attachment?.message?.thread) {
      throw new NotFoundException('Attachment not found');
    }
    if (attachment.message.thread.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    if (!this.storageService.isConfigured()) {
      throw new NotFoundException('File storage is not configured');
    }
    const presignedUrl = await this.storageService.getPresignedDownloadUrl(attachment.storageKey);
    res.redirect(302, presignedUrl);
  }
}
