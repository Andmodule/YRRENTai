import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBaseEntryEntity, KbStatus } from './entities/knowledge-base-entry.entity';
import { EmbeddingService } from '../embedding/embedding.service';

interface KbCreateData {
  title: string;
  content: string;
  category?: string;
  status?: KbStatus;
}

interface KbUpdateData {
  title?: string;
  content?: string;
  category?: string;
  status?: KbStatus;
}

interface KbRawRow {
  id: string;
  propertyId: string;
  title: string;
  content: string;
  category: string | null;
  status: KbStatus;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    @InjectRepository(KnowledgeBaseEntryEntity)
    private readonly kbRepository: Repository<KnowledgeBaseEntryEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async findAll(propertyId: string): Promise<KnowledgeBaseEntryEntity[]> {
    return this.kbRepository.find({ where: { propertyId, status: 'active' } });
  }

  async findAllWithStatus(
    propertyId: string,
    status?: KbStatus,
  ): Promise<KnowledgeBaseEntryEntity[]> {
    return this.kbRepository.find({
      where: status ? { propertyId, status } : { propertyId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Vector similarity search using pgvector cosine distance.
   * Gracefully falls back to full findAll if embeddings unavailable.
   */
  async searchRelevant(
    propertyId: string,
    query: string,
    limit = 8,
  ): Promise<KnowledgeBaseEntryEntity[]> {
    if (!this.embeddingService.isAvailable) {
      this.logger.warn('EmbeddingService unavailable — falling back to full KB scan');
      return this.findAll(propertyId);
    }

    try {
      const queryEmbedding = await this.embeddingService.createEmbedding(query);
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      const rows: KbRawRow[] = await this.kbRepository.query(
        `
        SELECT
          id,
          property_id   AS "propertyId",
          title,
          content,
          category,
          status,
          created_at    AS "createdAt",
          updated_at    AS "updatedAt"
        FROM knowledge_base_entries
        WHERE property_id = $1
          AND status = 'active'
          AND embedding IS NOT NULL
        ORDER BY embedding::vector <=> $2::vector
        LIMIT $3
        `,
        [propertyId, vectorStr, limit],
      );

      if (rows.length === 0) {
        this.logger.debug('No embedded entries yet — falling back to full KB scan');
        return this.findAll(propertyId);
      }

      return rows as unknown as KnowledgeBaseEntryEntity[];
    } catch (err) {
      this.logger.warn(`Vector search failed — falling back: ${(err as Error).message}`);
      return this.findAll(propertyId);
    }
  }

  async create(propertyId: string, data: KbCreateData): Promise<KnowledgeBaseEntryEntity> {
    const entry = this.kbRepository.create({ ...data, propertyId });
    const saved = await this.kbRepository.save(entry);

    this.scheduleEmbedding(saved.id, data.title, data.content);

    return saved;
  }

  async update(id: string, data: KbUpdateData): Promise<KnowledgeBaseEntryEntity> {
    const entry = await this.kbRepository.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('KB entry not found');

    const contentChanged =
      (data.title !== undefined && data.title !== entry.title) ||
      (data.content !== undefined && data.content !== entry.content);

    Object.assign(entry, data);
    const saved = await this.kbRepository.save(entry);

    if (contentChanged) {
      this.scheduleEmbedding(saved.id, saved.title, saved.content);
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const entry = await this.kbRepository.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('KB entry not found');
    await this.kbRepository.remove(entry);
  }

  /**
   * Re-generate embeddings for all active entries of a property that lack one.
   * Useful after adding OPENAI_API_KEY to an existing installation.
   */
  async backfillEmbeddings(propertyId: string): Promise<{ queued: number }> {
    const entries = await this.kbRepository.find({
      where: { propertyId, status: 'active' },
    });
    const missing = entries.filter((e) => !e.embedding);

    for (const entry of missing) {
      this.scheduleEmbedding(entry.id, entry.title, entry.content);
    }

    return { queued: missing.length };
  }

  private scheduleEmbedding(id: string, title: string, content: string): void {
    if (!this.embeddingService.isAvailable) return;

    this.generateAndSaveEmbedding(id, title, content).catch((err: Error) => {
      this.logger.error(`Embedding generation failed for ${id}: ${err.message}`);
    });
  }

  private async generateAndSaveEmbedding(
    id: string,
    title: string,
    content: string,
  ): Promise<void> {
    const text = `${title}\n${content}`;
    const embedding = await this.embeddingService.createEmbedding(text);
    await this.kbRepository.update(id, { embedding: JSON.stringify(embedding) });
    this.logger.debug(`Embedding saved for KB entry ${id}`);
  }
}
