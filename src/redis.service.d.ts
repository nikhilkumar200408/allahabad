import { ConfigService } from '@nestjs/config';
export declare class RedisService {
    private config;
    private client;
    private readonly logger;
    constructor(config: ConfigService);
    /**
     * Initialize Redis client with connection pooling
     */
    private initializeRedis;
    /**
     * SET with NX (only if not exists) and EX (expiry) options
     * Used for distributed lock acquisition
     */
    set(key: string, value: string, mode?: 'EX' | 'PX' | 'EXAT' | 'PXAT', ttl?: number, nx?: 'NX' | 'XX'): Promise<boolean>;
    /**
     * SETEX: Set with expiry (convenience method)
     */
    setex(key: string, seconds: number, value: string): Promise<void>;
    /**
     * GET: Retrieve value by key
     */
    get(key: string): Promise<string | null>;
    /**
     * DEL: Delete one or more keys
     */
    del(key: string | string[]): Promise<number>;
    /**
     * EXISTS: Check if keys exist
     */
    exists(key: string | string[]): Promise<number>;
    /**
     * INCR: Atomic increment (for rate limiting, sequence numbers)
     */
    incr(key: string): Promise<number>;
    /**
     * HSET: Set hash field
     */
    hset(key: string, field: string | Record<string, string>, value?: string): Promise<number>;
    /**
     * HGET: Get hash field
     */
    hget(key: string, field: string): Promise<string | null>;
    /**
     * HGETALL: Get all hash fields
     */
    hgetall(key: string): Promise<Record<string, string>>;
    /**
     * HDEL: Delete hash fields
     */
    hdel(key: string, field: string | string[]): Promise<number>;
    /**
     * RPUSH: Push to list (for queues)
     */
    rpush(key: string, value: string | string[]): Promise<number>;
    /**
     * LPOP: Pop from list
     */
    lpop(key: string): Promise<string | null>;
    /**
     * LRANGE: Get range from list
     */
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    /**
     * ZADD: Add to sorted set (for leaderboards, rate limiting by time)
     */
    zadd(key: string, members: Array<{
        score: number;
        value: string;
    }>): Promise<number>;
    /**
     * ZRANGE: Get range from sorted set
     */
    zrange(key: string, start: number, stop: number): Promise<string[]>;
    /**
     * EXPIRE: Set key expiry
     */
    expire(key: string, seconds: number): Promise<boolean>;
    /**
     * PING: Health check
     */
    ping(): Promise<string>;
    /**
     * Close Redis connection
     */
    disconnect(): Promise<void>;
}
export declare class DistributedLockService {
    private redis;
    private readonly logger;
    private readonly LOCK_TTL_MS;
    constructor(redis: RedisService);
    /**
     * Acquire lock with automatic retry
     * Returns lock token if successful, null otherwise
     */
    acquireLock(lockKey: string, maxRetries?: number): Promise<string | null>;
    /**
     * Release lock (compare-and-delete for safety)
     */
    releaseLock(lockKey: string, token: string): Promise<boolean>;
    /**
     * Extend lock TTL (for long-running operations)
     */
    extendLock(lockKey: string, token: string, additionalSeconds: number): Promise<boolean>;
    /**
     * Execute function with distributed lock
     * Automatically acquires and releases lock
     */
    executeWithLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T>;
}
