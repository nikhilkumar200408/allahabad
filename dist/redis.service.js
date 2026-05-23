"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RedisService_1, DistributedLockService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedLockService = exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis = __importStar(require("redis"));
let RedisService = RedisService_1 = class RedisService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(RedisService_1.name);
        this.initializeRedis();
    }
    async initializeRedis() {
        try {
            const redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
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
        }
        catch (error) {
            this.logger.error(`[REDIS-INIT-ERROR] Failed to initialize Redis: ${error.message}`);
            throw error;
        }
    }
    async set(key, value, mode, ttl, nx) {
        try {
            const options = {};
            if (nx)
                options.NX = true;
            if (nx === 'XX')
                options.XX = true;
            if (mode && ttl) {
                if (mode === 'EX')
                    options.EX = ttl;
                if (mode === 'PX')
                    options.PX = ttl;
            }
            const result = await this.client.set(key, value, options);
            return result === 'OK';
        }
        catch (error) {
            this.logger.error(`[REDIS-SET-ERROR] ${error.message}`);
            throw error;
        }
    }
    async setex(key, seconds, value) {
        try {
            await this.client.setEx(key, seconds, value);
        }
        catch (error) {
            this.logger.error(`[REDIS-SETEX-ERROR] ${error.message}`);
            throw error;
        }
    }
    async get(key) {
        try {
            return await this.client.get(key);
        }
        catch (error) {
            this.logger.error(`[REDIS-GET-ERROR] ${error.message}`);
            throw error;
        }
    }
    async del(key) {
        try {
            if (Array.isArray(key)) {
                return await this.client.del(key);
            }
            return await this.client.del([key]);
        }
        catch (error) {
            this.logger.error(`[REDIS-DEL-ERROR] ${error.message}`);
            throw error;
        }
    }
    async exists(key) {
        try {
            if (Array.isArray(key)) {
                return await this.client.exists(key);
            }
            return await this.client.exists([key]);
        }
        catch (error) {
            this.logger.error(`[REDIS-EXISTS-ERROR] ${error.message}`);
            throw error;
        }
    }
    async incr(key) {
        try {
            return await this.client.incr(key);
        }
        catch (error) {
            this.logger.error(`[REDIS-INCR-ERROR] ${error.message}`);
            throw error;
        }
    }
    async hset(key, field, value) {
        try {
            if (typeof field === 'object') {
                return await this.client.hSet(key, field);
            }
            return await this.client.hSet(key, field, value);
        }
        catch (error) {
            this.logger.error(`[REDIS-HSET-ERROR] ${error.message}`);
            throw error;
        }
    }
    async hget(key, field) {
        try {
            return await this.client.hGet(key, field);
        }
        catch (error) {
            this.logger.error(`[REDIS-HGET-ERROR] ${error.message}`);
            throw error;
        }
    }
    async hgetall(key) {
        try {
            return await this.client.hGetAll(key);
        }
        catch (error) {
            this.logger.error(`[REDIS-HGETALL-ERROR] ${error.message}`);
            throw error;
        }
    }
    async hdel(key, field) {
        try {
            if (Array.isArray(field)) {
                return await this.client.hDel(key, field);
            }
            return await this.client.hDel(key, [field]);
        }
        catch (error) {
            this.logger.error(`[REDIS-HDEL-ERROR] ${error.message}`);
            throw error;
        }
    }
    async rpush(key, value) {
        try {
            const values = Array.isArray(value) ? value : [value];
            return await this.client.rPush(key, values);
        }
        catch (error) {
            this.logger.error(`[REDIS-RPUSH-ERROR] ${error.message}`);
            throw error;
        }
    }
    async lpop(key) {
        try {
            return await this.client.lPop(key);
        }
        catch (error) {
            this.logger.error(`[REDIS-LPOP-ERROR] ${error.message}`);
            throw error;
        }
    }
    async lrange(key, start, stop) {
        try {
            return await this.client.lRange(key, start, stop);
        }
        catch (error) {
            this.logger.error(`[REDIS-LRANGE-ERROR] ${error.message}`);
            throw error;
        }
    }
    async zadd(key, members) {
        try {
            const memberObjects = members.map((m) => ({
                score: m.score,
                value: m.value,
            }));
            return await this.client.zAdd(key, memberObjects);
        }
        catch (error) {
            this.logger.error(`[REDIS-ZADD-ERROR] ${error.message}`);
            throw error;
        }
    }
    async zrange(key, start, stop) {
        try {
            return await this.client.zRange(key, start, stop);
        }
        catch (error) {
            this.logger.error(`[REDIS-ZRANGE-ERROR] ${error.message}`);
            throw error;
        }
    }
    async expire(key, seconds) {
        try {
            const result = await this.client.expire(key, seconds);
            return Boolean(result);
        }
        catch (error) {
            this.logger.error(`[REDIS-EXPIRE-ERROR] ${error.message}`);
            throw error;
        }
    }
    async ping() {
        try {
            return await this.client.ping();
        }
        catch (error) {
            this.logger.error(`[REDIS-PING-ERROR] ${error.message}`);
            throw error;
        }
    }
    async disconnect() {
        try {
            await this.client.quit();
            this.logger.log('[REDIS-DISCONNECTED]');
        }
        catch (error) {
            this.logger.error(`[REDIS-DISCONNECT-ERROR] ${error.message}`);
            throw error;
        }
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = RedisService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RedisService);
let DistributedLockService = DistributedLockService_1 = class DistributedLockService {
    constructor(redis) {
        this.redis = redis;
        this.logger = new common_1.Logger(DistributedLockService_1.name);
        this.LOCK_TTL_MS = 30000;
    }
    async acquireLock(lockKey, maxRetries = 3) {
        let retries = 0;
        while (retries < maxRetries) {
            const token = crypto.randomUUID();
            const acquired = await this.redis.set(`lock:${lockKey}`, token, 'EX', Math.floor(this.LOCK_TTL_MS / 1000), 'NX');
            if (acquired) {
                this.logger.debug(`[LOCK-ACQUIRED] ${lockKey}`);
                return token;
            }
            retries++;
            const delay = 50 * Math.pow(2, retries);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        this.logger.warn(`[LOCK-FAILED] Could not acquire lock: ${lockKey}`);
        return null;
    }
    async releaseLock(lockKey, token) {
        try {
            const currentToken = await this.redis.get(`lock:${lockKey}`);
            if (currentToken === token) {
                await this.redis.del(`lock:${lockKey}`);
                this.logger.debug(`[LOCK-RELEASED] ${lockKey}`);
                return true;
            }
            this.logger.warn(`[LOCK-RELEASE-FAILED] Token mismatch for ${lockKey}`);
            return false;
        }
        catch (error) {
            this.logger.error(`[LOCK-RELEASE-ERROR] ${error.message}`);
            return false;
        }
    }
    async extendLock(lockKey, token, additionalSeconds) {
        try {
            const currentToken = await this.redis.get(`lock:${lockKey}`);
            if (currentToken === token) {
                await this.redis.expire(`lock:${lockKey}`, additionalSeconds);
                this.logger.debug(`[LOCK-EXTENDED] ${lockKey}`);
                return true;
            }
            return false;
        }
        catch (error) {
            this.logger.error(`[LOCK-EXTEND-ERROR] ${error.message}`);
            return false;
        }
    }
    async executeWithLock(lockKey, fn) {
        const token = await this.acquireLock(lockKey);
        if (!token) {
            throw new Error(`Could not acquire lock: ${lockKey}`);
        }
        try {
            return await fn();
        }
        finally {
            await this.releaseLock(lockKey, token);
        }
    }
};
exports.DistributedLockService = DistributedLockService;
exports.DistributedLockService = DistributedLockService = DistributedLockService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [RedisService])
], DistributedLockService);
//# sourceMappingURL=redis.service.js.map