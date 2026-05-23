// Core Banking Platform - Redis Service
// Distributed locking (Redlock), caching, and session management

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as redis from 'redis';
import { RedisClientType } from 'redis';

// ============================================================================
// REDIS SERVICE (Distributed Locking & Caching)
// ============================================================================

@Injectable()
export class RedisService {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {
    this.initializeRedis();
  }

  /**
   * Initialize Redis client with connection pooling
   */
  private async initializeRedis(): Promise<void> {
    try {
      const redisUrl = this.config.get<string>(
        'REDIS_URL',
        'redis://localhost:6379',
      );

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              return new Error('Max Redis retries exceeded');
            }
            return retries * 50;
          },
        },
      });

      this.client.on('error', (err) => {
        this.logger.error(`[REDIS-ERROR] ${err.message}`);
      });

      this.client.on('connect', () => {
        this.logger.log('[REDIS-CONNECTED]');
      });

      await this.client.connect();
    } catch (error) {
      this.logger.error(
        `[REDIS-INIT-ERROR] Failed to initialize Redis: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * SET with NX (only if not exists) and EX (expiry) options
   * Used for distributed lock acquisition
   */
  async set(
    key: string,
    value: string,
    mode?: 'EX' | 'PX' | 'EXAT' | 'PXAT',
    ttl?: number,
    nx?: 'NX' | 'XX',
  ): Promise<boolean> {
    try {
      const options: any = {};

      if (nx) options.NX = true;
      if (nx === 'XX') options.XX = true;
      if (mode && ttl) {
        if (mode === 'EX') options.EX = ttl;
        if (mode === 'PX') options.PX = ttl;
      }

      const result = await this.client.set(key, value, options);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`[REDIS-SET-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * SETEX: Set with expiry (convenience method)
   */
  async setex(
    key: string,
    seconds: number,
    value: string,
  ): Promise<void> {
    try {
      await this.client.setEx(key, seconds, value);
    } catch (error) {
      this.logger.error(`[REDIS-SETEX-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * GET: Retrieve value by key
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`[REDIS-GET-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * DEL: Delete one or more keys
   */
  async del(key: string | string[]): Promise<number> {
    try {
      if (Array.isArray(key)) {
        return await this.client.del(key);
      }
      return await this.client.del([key]);
    } catch (error) {
      this.logger.error(`[REDIS-DEL-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * EXISTS: Check if keys exist
   */
  async exists(key: string | string[]): Promise<number> {
    try {
      if (Array.isArray(key)) {
        return await this.client.exists(key);
      }
      return await this.client.exists([key]);
    } catch (error) {
      this.logger.error(`[REDIS-EXISTS-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * INCR: Atomic increment (for rate limiting, sequence numbers)
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error(`[REDIS-INCR-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * HSET: Set hash field
   */
  async hset(
    key: string,
    field: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    try {
      if (typeof field === 'object') {
        return await this.client.hSet(key, field);
      }
      return await this.client.hSet(key, field, value!);
    } catch (error) {
      this.logger.error(`[REDIS-HSET-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * HGET: Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      this.logger.error(`[REDIS-HGET-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * HGETALL: Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      this.logger.error(`[REDIS-HGETALL-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * HDEL: Delete hash fields
   */
  async hdel(key: string, field: string | string[]): Promise<number> {
    try {
      if (Array.isArray(field)) {
        return await this.client.hDel(key, field);
      }
      return await this.client.hDel(key, [field]);
    } catch (error) {
      this.logger.error(`[REDIS-HDEL-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * RPUSH: Push to list (for queues)
   */
  async rpush(key: string, value: string | string[]): Promise<number> {
    try {
      const values = Array.isArray(value) ? value : [value];
      return await this.client.rPush(key, values);
    } catch (error) {
      this.logger.error(`[REDIS-RPUSH-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * LPOP: Pop from list
   */
  async lpop(key: string): Promise<string | null> {
    try {
      return await this.client.lPop(key);
    } catch (error) {
      this.logger.error(`[REDIS-LPOP-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * LRANGE: Get range from list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      this.logger.error(`[REDIS-LRANGE-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * ZADD: Add to sorted set (for leaderboards, rate limiting by time)
   */
  async zadd(
    key: string,
    members: Array<{ score: number; value: string }>,
  ): Promise<number> {
    try {
      const memberObjects = members.map((m) => ({
        score: m.score,
        value: m.value,
      }));
      return await this.client.zAdd(key, memberObjects);
    } catch (error) {
      this.logger.error(`[REDIS-ZADD-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * ZRANGE: Get range from sorted set
   */
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.zRange(key, start, stop);
    } catch (error) {
      this.logger.error(`[REDIS-ZRANGE-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * EXPIRE: Set key expiry
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return Boolean(result);
    } catch (error) {
      this.logger.error(`[REDIS-EXPIRE-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * PING: Health check
   */
  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      this.logger.error(`[REDIS-PING-ERROR] ${error.message}`);
      throw error;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('[REDIS-DISCONNECTED]');
    } catch (error) {
      this.logger.error(`[REDIS-DISCONNECT-ERROR] ${error.message}`);
      throw error;
    }
  }
}

// ============================================================================
// DISTRIBUTED LOCK SERVICE (Redlock Algorithm)
// ============================================================================

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly LOCK_TTL_MS = 30000; // 30 second lock expiry

  constructor(private redis: RedisService) {}

  /**
   * Acquire lock with automatic retry
   * Returns lock token if successful, null otherwise
   */
  async acquireLock(
    lockKey: string,
    maxRetries: number = 3,
  ): Promise<string | null> {
    let retries = 0;

    while (retries < maxRetries) {
      const token = crypto.randomUUID();

      const acquired = await this.redis.set(
        `lock:${lockKey}`,
        token,
        'EX',
        Math.floor(this.LOCK_TTL_MS / 1000),
        'NX',
      );

      if (acquired) {
        this.logger.debug(`[LOCK-ACQUIRED] ${lockKey}`);
        return token;
      }

      retries++;
      // Exponential backoff: 50ms * 2^retry
      const delay = 50 * Math.pow(2, retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.logger.warn(`[LOCK-FAILED] Could not acquire lock: ${lockKey}`);
    return null;
  }

  /**
   * Release lock (compare-and-delete for safety)
   */
  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    try {
      const currentToken = await this.redis.get(`lock:${lockKey}`);

      // Only delete if token matches (prevent deleting other's locks)
      if (currentToken === token) {
        await this.redis.del(`lock:${lockKey}`);
        this.logger.debug(`[LOCK-RELEASED] ${lockKey}`);
        return true;
      }

      this.logger.warn(
        `[LOCK-RELEASE-FAILED] Token mismatch for ${lockKey}`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `[LOCK-RELEASE-ERROR] ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Extend lock TTL (for long-running operations)
   */
  async extendLock(
    lockKey: string,
    token: string,
    additionalSeconds: number,
  ): Promise<boolean> {
    try {
      const currentToken = await this.redis.get(`lock:${lockKey}`);

      if (currentToken === token) {
        await this.redis.expire(
          `lock:${lockKey}`,
          additionalSeconds,
        );
        this.logger.debug(`[LOCK-EXTENDED] ${lockKey}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `[LOCK-EXTEND-ERROR] ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Execute function with distributed lock
   * Automatically acquires and releases lock
   */
  async executeWithLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const token = await this.acquireLock(lockKey);

    if (!token) {
      throw new Error(`Could not acquire lock: ${lockKey}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(lockKey, token);
    }
  }
}
