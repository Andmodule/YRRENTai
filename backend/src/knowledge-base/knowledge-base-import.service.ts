import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { KnowledgeBaseEntryEntity } from './entities/knowledge-base-entry.entity';
import { buildImportPrompt, VALID_CATEGORIES } from './constants/kb-import-prompt';
import { EmbeddingService } from '../embedding/embedding.service';

const SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

export interface KbImportDraft {
  id: string;
  title: string;
  content: string;
  category: string;
}

@Injectable()
export class KnowledgeBaseImportService {
  private readonly logger = new Logger(KnowledgeBaseImportService.name);

  constructor(
    @InjectRepository(KnowledgeBaseEntryEntity)
    private readonly kbRepository: Repository<KnowledgeBaseEntryEntity>,
    private readonly configService: ConfigService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    if (mimeType === 'application/pdf') {
      const pdfModule = await import('pdf-parse');
      const pdfParse = (pdfModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default;
      const result = await pdfParse(buffer);
      return result.text;
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    return buffer.toString('utf-8');
  }

  async extractTextFromUrl(url: string): Promise<string> {
    const response = await axios.get<string>(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'RentAI-Bot/1.0' },
      responseType: 'text',
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, [role="navigation"]').remove();

    const main =
      $('main').text() ||
      $('article').text() ||
      $('[class*="content"]').first().text() ||
      $('body').text();

    return main.replace(/\s{3,}/g, '\n\n').trim();
  }

  /**
   * LLM step: prompt and category rules live in `kb-import-prompt.ts` (`buildImportPrompt`).
   * Text is clipped to KB_IMPORT_TEXT_MAX_CHARS there.
   */
  async parseToEntries(rawText: string): Promise<KbImportDraft[]> {
    if (!rawText.trim()) {
      throw new BadRequestException('Extracted text is empty');
    }

    const provider = this.configService.get<string>('AI_PROVIDER', 'deepseek');
    const client = this.buildLlmClient(provider);
    const model = provider === 'openai' ? 'gpt-4o' : 'deepseek-chat';

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: buildImportPrompt(rawText),
        },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? '[]';

    let parsed: unknown[];
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned) as unknown[];
    } catch {
      this.logger.error('LLM returned invalid JSON', raw.slice(0, 300));
      throw new BadRequestException('AI could not parse the document into structured entries');
    }

    const drafts: KbImportDraft[] = (parsed as { title?: unknown; content?: unknown; category?: unknown }[])
      .filter((item) => item.title && item.content)
      .map((item, idx) => ({
        id: `draft-${idx}`,
        title: String(item.title).slice(0, 80),
        content: String(item.content),
        category: VALID_CATEGORIES.includes(item.category as typeof VALID_CATEGORIES[number])
          ? String(item.category)
          : 'other',
      }));

    return drafts;
  }

  async confirmDrafts(
    propertyId: string,
    drafts: KbImportDraft[],
  ): Promise<KnowledgeBaseEntryEntity[]> {
    const entities = this.kbRepository.create(
      drafts.map((d) => ({
        propertyId,
        title: d.title,
        content: d.content,
        category: d.category,
        status: 'active' as const,
      })),
    );

    const saved = await this.kbRepository.save(entities);

    if (this.embeddingService.isAvailable) {
      for (const entry of saved) {
        this.generateEmbeddingAsync(entry);
      }
    }

    return saved;
  }

  private async generateEmbeddingAsync(entry: KnowledgeBaseEntryEntity): Promise<void> {
    try {
      const text = `${entry.title}\n${entry.content}`;
      const embedding = await this.embeddingService.createEmbedding(text);
      await this.kbRepository.update(entry.id, { embedding: JSON.stringify(embedding) });
    } catch (err) {
      this.logger.error(`Embedding failed for import entry ${entry.id}: ${(err as Error).message}`);
    }
  }

  private buildLlmClient(provider: string): OpenAI {
    if (provider === 'openai') {
      return new OpenAI({
        apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      });
    }
    return new OpenAI({
      apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      baseURL: this.configService.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    });
  }

  isSupportedMime(mime: string): boolean {
    return SUPPORTED_MIME.includes(mime);
  }
}
