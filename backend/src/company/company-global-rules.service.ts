import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompanyGlobalQaEntry, CompanyGlobalRulesDto } from '@rentai/shared';
import { CompanyEntity } from '../user/entities/company.entity';
import { PropertyEntity } from '../property/entities/property.entity';

export interface CompanyGlobalRulesPayload {
  globalDescription: string | null;
  globalRules: string | null;
  globalQaEntries: CompanyGlobalQaEntry[];
  updatedAt: string;
}

@Injectable()
export class CompanyGlobalRulesService {
  constructor(
    @InjectRepository(CompanyEntity)
    private readonly companyRepo: Repository<CompanyEntity>,
    @InjectRepository(PropertyEntity)
    private readonly propertyRepo: Repository<PropertyEntity>,
  ) {}

  async getByCompanyId(companyId: string): Promise<CompanyGlobalRulesPayload> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return this.toPayload(company);
  }

  async getForProperty(propertyId: string): Promise<CompanyGlobalRulesPayload | null> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      select: ['id', 'companyId'],
    });
    if (!property?.companyId) return null;
    return this.getByCompanyId(property.companyId);
  }

  async updateByCompanyId(
    companyId: string,
    dto: CompanyGlobalRulesDto,
  ): Promise<CompanyGlobalRulesPayload> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    if (dto.globalDescription !== undefined) {
      company.globalDescription = dto.globalDescription;
    }
    if (dto.globalRules !== undefined) {
      company.globalRules = dto.globalRules;
    }
    if (dto.globalQaEntries !== undefined) {
      company.globalQaEntries = this.normalizeQaEntries(dto.globalQaEntries);
    }
    const saved = await this.companyRepo.save(company);
    return this.toPayload(saved);
  }

  private toPayload(company: CompanyEntity): CompanyGlobalRulesPayload {
    return {
      globalDescription: company.globalDescription?.trim() || null,
      globalRules: company.globalRules?.trim() || null,
      globalQaEntries: this.normalizeQaEntries(company.globalQaEntries),
      updatedAt: company.updatedAt.toISOString(),
    };
  }

  private normalizeQaEntries(raw: unknown): CompanyGlobalQaEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: CompanyGlobalQaEntry[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const question = typeof row.question === 'string' ? row.question.trim() : '';
      const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
      if (!id || !question || !answer) continue;
      out.push({ id, question, answer });
    }
    return out.slice(0, 50);
  }
}
