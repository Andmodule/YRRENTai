import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertZodomusSuccess } from './zodomus-status.util';

const FETCH_MAX_ATTEMPTS = 3;

@Injectable()
export class ZodomusClient {
  private readonly logger = new Logger(ZodomusClient.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('ZODOMUS_BASE_URL').replace(/\/$/, '');
    const user = this.config.getOrThrow<string>('ZODOMUS_API_USER');
    const pass = this.config.getOrThrow<string>('ZODOMUS_API_PASSWORD');
    this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
    this.fetchTimeoutMs = this.config.get<number>('ZODOMUS_FETCH_TIMEOUT_MS') ?? 8000;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }

    const label = `GET ${path}`;
    const res = await this.fetchWithRetry(label, () =>
      this.timedFetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      }),
    );

    return this.handleResponse<T>(res, label);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const p = path.startsWith('/') ? path : `/${path}`;
    const label = `POST ${path}`;
    const res = await this.fetchWithRetry(label, () =>
      this.timedFetch(`${this.baseUrl}${p}`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      }),
    );

    return this.handleResponse<T>(res, label);
  }

  /** Single fetch with AbortController timeout (each retry gets a new timer). */
  private async timedFetch(url: string, init: Omit<RequestInit, 'signal'>): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.fetchTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (timedOut && e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Zodomus fetch timed out after ${this.fetchTimeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Retries only when fetch() throws (no Response) — transient DNS/TLS/network/timeout.
   * Does not retry HTTP 4xx/5xx; those are handled in handleResponse.
   */
  private async fetchWithRetry(
    label: string,
    doFetch: () => Promise<Response>,
  ): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        return await doFetch();
      } catch (e) {
        lastErr = e;
        const detail = this.describeFetchError(e);
        if (attempt < FETCH_MAX_ATTEMPTS) {
          this.logger.warn(
            `Zodomus ${label}: fetch failed (${attempt}/${FETCH_MAX_ATTEMPTS}) — ${detail}; retrying in ${attempt}s`,
          );
          await new Promise((r) => setTimeout(r, attempt * 1000));
          continue;
        }
        this.logger.error(
          `Zodomus ${label}: fetch failed after ${FETCH_MAX_ATTEMPTS} attempts — ${detail}`,
        );
        throw new ServiceUnavailableException({
          message: 'Zodomus API unreachable',
          detail,
        });
      }
    }
    throw lastErr;
  }

  private describeFetchError(e: unknown): string {
    if (e instanceof Error) {
      const withCause = e as Error & { cause?: unknown };
      const c = withCause.cause;
      const causePart =
        c instanceof Error
          ? c.message
          : c != null && typeof c === 'object' && 'code' in c
            ? String((c as { code?: string }).code ?? c)
            : c != null
              ? String(c)
              : '';
      return causePart ? `${e.message} [cause: ${causePart}]` : e.message;
    }
    return String(e);
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
