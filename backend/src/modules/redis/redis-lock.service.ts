import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type MemoryEntry = { value: string; expiresAt: number };

/**
 * Distributed idempotency / lease primitives using Redis `SET … PX … NX`.
 * When `REDIS_URL` is unset, uses an in-process Map (single-instance dev only).
 */
@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('REDIS_URL')?.trim();
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      this.logger.log('RedisLockService: using ioredis (REDIS_URL set)');
    } else {
      this.redis = null;
      this.logger.warn(
        'RedisLockService: REDIS_URL unset — in-memory lock fallback (not safe across multiple API instances)',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  /** Current value, or null if missing / expired (memory path prunes). */
  async get(key: string): Promise<string | null> {
    if (this.redis) {
      return this.redis.get(key);
    }
    return this.memoryGet(key);
  }

  /**
   * Acquire lease: `SET key "1" PX ttlMs NX`.
   * @returns true if lock acquired, false if key already exists.
   */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    if (this.redis) {
      const r = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
      return r === 'OK';
    }
    return this.memoryAcquire(key, ttlMs);
  }

  /** Remove key (rollback after failed execution). */
  async releaseLock(key: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(key);
      return;
    }
    this.memory.delete(key);
  }

  /** Mark completion: `SET key "done" PX ttlMs` (overwrites lease). */
  async setDone(key: string, ttlMs: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, 'done', 'PX', ttlMs);
      return;
    }
    this.memorySet(key, 'done', ttlMs);
  }

  private memoryGet(key: string): string | null {
    const e = this.memory.get(key);
    if (!e) return null;
    if (Date.now() >= e.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    return e.value;
  }

  private memoryAcquire(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const cur = this.memory.get(key);
    if (cur && now < cur.expiresAt) {
      return false;
    }
    this.memory.set(key, { value: '1', expiresAt: now + ttlMs });
    return true;
  }

  private memorySet(key: string, value: string, ttlMs: number): void {
    this.memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
