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
var AuthGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuard = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const crypto = __importStar(require("crypto"));
let AuthGuard = AuthGuard_1 = class AuthGuard {
    constructor(jwtService, prisma, redis, config) {
        this.jwtService = jwtService;
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.logger = new common_1.Logger(AuthGuard_1.name);
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const token = this.extractBearerToken(request);
        if (!token) {
            throw new common_1.UnauthorizedException('Authorization header missing or malformed. Expected: Bearer <token>');
        }
        let payload;
        try {
            payload = await this.jwtService.verifyAsync(token, {
                secret: this.config.get('JWT_SECRET'),
                issuer: this.config.get('JWT_ISSUER', 'banking-platform'),
                audience: this.config.get('JWT_AUDIENCE', 'banking-platform-api'),
            });
        }
        catch (err) {
            this.logger.warn(`[AUTH-GUARD] JWT verification failed: ${err.message}`);
            throw new common_1.UnauthorizedException('Invalid or expired token. Please log in again.');
        }
        const sessionCacheKey = `session:${payload.sessionId}`;
        const cachedSession = await this.redis
            .get(sessionCacheKey)
            .catch(() => null);
        if (cachedSession === null) {
            const tokenHash = crypto
                .createHash('sha256')
                .update(token)
                .digest('hex');
            const dbSession = await this.prisma.session
                .findUnique({
                where: { tokenHash },
                select: {
                    id: true,
                    userId: true,
                    expiresAt: true,
                    revokedAt: true,
                },
            })
                .catch(() => null);
            if (!dbSession) {
                throw new common_1.UnauthorizedException('Session not found. Please log in again.');
            }
            if (dbSession.revokedAt) {
                throw new common_1.UnauthorizedException('Session has been revoked. Please log in again.');
            }
            if (dbSession.expiresAt < new Date()) {
                throw new common_1.UnauthorizedException('Session has expired. Please log in.');
            }
            const remainingSec = Math.min(Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000), 3600);
            await this.redis
                .setex(sessionCacheKey, remainingSec, 'valid')
                .catch(() => {
            });
        }
        else if (cachedSession === 'revoked') {
            throw new common_1.UnauthorizedException('Session has been revoked. Please log in again.');
        }
        const authenticatedUser = {
            id: payload.sub,
            email: payload.email,
            upiHandle: payload.upiHandle,
            sessionId: payload.sessionId,
            deviceId: payload.deviceId,
        };
        request.user = authenticatedUser;
        return true;
    }
    extractBearerToken(request) {
        const authHeader = request.headers['authorization'];
        if (!authHeader)
            return null;
        const [scheme, token] = authHeader.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token)
            return null;
        return token;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = AuthGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService])
], AuthGuard);
//# sourceMappingURL=auth.guard.js.map