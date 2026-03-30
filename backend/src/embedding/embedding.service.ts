import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_INPUT_CHARS = 32000;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private client: OpenAI | null = null;

  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for embeddings');
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  get isAvailable(): boolean {
    return !!this.configService.get<string>('OPENAI_API_KEY');
  }

  async createEmbedding(text: string): Promise<number[]> {
    const client = this.getClient();
    const truncated = text.slice(0, MAX_INPUT_CHARS);

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncated,
    });

    return response.data[0]!.embedding;
  }
}
