import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AgentService } from './agent.service';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Agent')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('message')
  @Roles('OWNER', 'MANAGER')
  async sendMessage(
    @Body() body: { propertyId: string; message: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const response = await this.agentService.processMessage(
      'Test Property',
      'No knowledge base yet.',
      body.message,
      [],
    );
    return {
      data: {
        response,
        provider: 'deepseek',
        propertyId: body.propertyId,
        userId: user.sub,
      },
    };
  }
}
