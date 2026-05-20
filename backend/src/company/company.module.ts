import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyEntity } from '../user/entities/company.entity';
import { PropertyEntity } from '../property/entities/property.entity';
import { UserModule } from '../user/user.module';
import { CompanyGlobalRulesService } from './company-global-rules.service';
import { CompanyGlobalRulesController } from './company-global-rules.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyEntity, PropertyEntity]), UserModule],
  controllers: [CompanyGlobalRulesController],
  providers: [CompanyGlobalRulesService],
  exports: [CompanyGlobalRulesService],
})
export class CompanyModule {}
