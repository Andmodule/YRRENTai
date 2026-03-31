import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertZodomusSuccess } from './zodomus-status.util';

@Injectable()
export class ZodomusClient {
  private readonly logger = new Logger(ZodomusClient.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('ZODOMUS_BASE_URL').replace(/\/$/, '');
    const user = this.config.getOrThrow<string>('ZODOMUS_API_USER');
    const pass = this.config.getOrThrow<string>('ZODOMUS_API_PASSWORD');
    this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    });

    return this.handleResponse<T>(res, `GET ${path}`);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const p = path.startsWith('/') ? path : `/${path}`;
    const res = await fetch(`${this.baseUrl}${p}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });

    return this.handleResponse<T>(res, `POST ${path}`);
  }

  private async handleResponse<T>(res: Response, label: string): Promise<T> {
    const text = await res.text();
    if (res.ok) {
      if (!text) return undefined as T;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        this.logger.warn(`Zodomus ${label}: non-JSON body`);
        return text as unknown as T;
      }
      assertZodomusSuccess(label, parsed);
      return this.unwrapData(parsed) as T;
    }

    this.logger.error(`Zodomus ${label} → ${res.status}: ${text}`);
    throw new HttpException(
      { message: 'Zodomus upstream error', upstreamStatus: res.status, detail: text },
      502,
    );
  }

  /** Unwrap `{ data: T }` or return payload as-is. */
  private unwrapData<T>(parsed: unknown): T {
    if (parsed !== null && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: T }).data;
    }
    return parsed as T;
  }
}
