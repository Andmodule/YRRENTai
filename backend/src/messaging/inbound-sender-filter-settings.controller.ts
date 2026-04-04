import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { InboundSenderFilterService } from './inbound-sender-filter.service';
import { PatchInboundSenderFilterDto } from './dto/patch-inbound-sender-filter.dto';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('settings/inbound-sender-filter')
export class InboundSenderFilterSettingsController {
  constructor(private readonly filter: InboundSenderFilterService) {}

  @Get()
  @Roles('OWNER')
  async get() {
    return this.filter.getSettings();
  }

  @Patch()
  @Roles('OWNER')
  async patch(@Body() dto: PatchInboundSenderFilterDto) {
    return this.filter.updateSettings({
      allowedHosts: dto.allowedHosts,
      allowGmailGooglemail: dto.allowGmailGooglemail,
    });
  }
}
