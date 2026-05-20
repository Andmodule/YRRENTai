import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { companyGlobalRulesSchema } from '@rentai/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { UserService } from '../user/user.service';
import { CompanyGlobalRulesService } from './company-global-rules.service';

@ApiTags('Company')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('company')
export class CompanyGlobalRulesController {
  constructor(
    private readonly globalRulesService: CompanyGlobalRulesService,
    private readonly userService: UserService,
  ) {}

  @Get('global-rules')
  @Roles('OWNER', 'MANAGER')
  async getGlobalRules(@CurrentUser() user: JwtPayload) {
    const companyId = await this.userService.resolveCompanyId(user.sub, user.role);
    if (!companyId) {
      return {
        data: { globalDescription: null, globalRules: null, globalQaEntries: [], updatedAt: null },
      };
    }
    const data = await this.globalRulesService.getByCompanyId(companyId);
    return { data };
  }

  @Patch('global-rules')
  @Roles('OWNER', 'MANAGER')
  async patchGlobalRules(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const companyId = await this.userService.resolveCompanyId(user.sub, user.role);
    if (!companyId) {
      throw new BadRequestException('Company context required');
    }
    const dto = companyGlobalRulesSchema.parse(body);
    const data = await this.globalRulesService.updateByCompanyId(companyId, dto);
    return { data };
  }
}
