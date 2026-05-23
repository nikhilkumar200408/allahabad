import { ConfigService } from '@nestjs/config';
export declare class RedisService {
    private config;
    private client;
    private readonly logger;
    constructor(config: ConfigService);
    private initializeRedis;
    set(key: string, value: string, mode?: 'EX' | 'PX' | 'EXAT' | 'PXAT', ttl?: number, nx?: 'NX' | 'XX'): Promise<boolean>;
    setex(key: string, seconds: number, value: string): Promise<void>;
    get(key: string): Promise<string | null>;
    del(key: string | string[]): Promise<number>;
    exists(key: string | string[]): Promise<number>;
    incr(key: string): Promise<number>;
    hset(key: string, field: string | Record<string, string>, value?: string): Promise<number>;
    hget(key: string, field: string): Promise<string | null>;
    hgetall(key: string): Promise<Record<string, string>>;
    hdel(key: string, field: string | string[]): Promise<number>;
    rpush(key: string, value: string | string[]): Promise<number>;
    lpop(key: string): Promise<string | null>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    zadd(key: string, members: Array<{
        score: number;
        value: string;
    }>): Promise<number>;
    zrange(key: string, start: number, stop: number): Promise<string[]>;
    expire(key: string, seconds: number): Promise<boolean>;
    ping(): Promise<string>;
    disconnect(): Promise<void>;
}
export declare class DistributedLockService {
    private redis;
    private readonly logger;
    private readonly LOCK_TTL_MS;
    constructor(redis: RedisService);
    acquireLock(lockKey: string, maxRetries?: number): Promise<string | null>;
    releaseLock(lockKey: string, token: string): Promise<boolean>;
    extendLock(lockKey: string, token: string, additionalSeconds: number): Promise<boolean>;
    executeWithLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T>;
}
