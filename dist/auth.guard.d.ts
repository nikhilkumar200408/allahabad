import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
export interface AuthenticatedUser {
    id: string;
    email: string;
    upiHandle: string;
    sessionId: string;
    deviceId: string;
}
export declare class AuthGuard implements CanActivate {
    private readonly jwtService;
    private readonly prisma;
    private readonly redis;
    private readonly config;
    private readonly logger;
    constructor(jwtService: JwtService, prisma: PrismaService, redis: RedisService, config: ConfigService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private extractBearerToken;
}
