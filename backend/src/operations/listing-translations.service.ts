import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyService } from '../property/property.service';
import { PropertyListingTranslationEntity } from './entities/property-listing-translation.entity';

const CHANNEL_LOCALES = ['en', 'ru', 'pl', 'de', 'es'] as const;

export interface ListingTranslationDto {
  id: string;
  propertyId: string;
  locale: string;
  title: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  updatedAt: string;
}

@Injectable()
export class ListingTranslationsService {
  constructor(
    @InjectRepository(PropertyListingTranslationEntity)
    private readonly repo: Repository<PropertyListingTranslationEntity>,
    private readonly propertyService: PropertyService,
  ) {}

  private toDto(e: PropertyListingTranslationEntity): ListingTranslationDto {
    return {
      id: e.id,
      propertyId: e.propertyId,
      locale: e.locale,
      title: e.title,
      shortDescription: e.shortDescription,
      longDescription: e.longDescription,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  async listForProperty(ownerId: string, propertyId: string): Promise<ListingTranslationDto[]> {
    await this.propertyService.findOne(propertyId, ownerId);
    const rows = await this.repo.find({
      where: { propertyId },
      order: { locale: 'ASC' },
    });

    const byLocale = new Map(rows.map((r) => [r.locale, r]));
    const result: ListingTranslationDto[] = [];
    for (const loc of CHANNEL_LOCALES) {
      const existing = byLocale.get(loc);
      if (existing) {
        result.push(this.toDto(existing));
      } else {
        result.push({
          id: '',
          propertyId,
          locale: loc,
          title: null,
          shortDescription: null,
          longDescription: null,
          updatedAt: new Date(0).toISOString(),
        });
      }
    }
    return result;
  }

  async upsert(
    ownerId: string,
    propertyId: string,
    locale: string,
    body: {
      title?: string | null;
      shortDescription?: string | null;
      longDescription?: string | null;
    },
  ): Promise<ListingTranslationDto> {
    await this.propertyService.findOne(propertyId, ownerId);
    const loc = locale.trim().toLowerCase();
    if (!CHANNEL_LOCALES.includes(loc as (typeof CHANNEL_LOCALES)[number])) {
      throw new BadRequestException('Unsupported locale');
    }

    let row = await this.repo.findOne({ where: { propertyId, locale: loc } });
    if (!row) {
      row = this.repo.create({ propertyId, locale: loc });
    }
    if (body.title !== undefined) row.title = body.title?.trim() || null;
    if (body.shortDescription !== undefined)
      row.shortDescription = body.shortDescription?.trim() || null;
    if (body.longDescription !== undefined)
      row.longDescription = body.longDescription?.trim() || null;

    const saved = await this.repo.save(row);
    return this.toDto(saved);
  }

  async delete(ownerId: string, propertyId: string, locale: string): Promise<void> {
    await this.propertyService.findOne(propertyId, ownerId);
    const row = await this.repo.findOne({ where: { propertyId, locale: locale.trim().toLowerCase() } });
    if (!row) throw new NotFoundException();
    await this.repo.remove(row);
  }
}
