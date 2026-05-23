import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
export interface AuthPayload {
    sub: string;
    email: string;
    upiHandle: string;
    sessionId: string;
    deviceId: string;
    iat: number;
    exp: number;
}
export interface LoginResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
        id: string;
        email: string;
        upiHandle: string;
        kycStatus: string;
    };
}
export interface SessionMetadata {
    userId: string;
    sessionId: string;
    deviceId: string;
    userAgent: string;
    ipAddress: string;
    createdAt: Date;
    lastActivityAt: Date;
    expiresAt: Date;
}
export declare class AuthenticationService {
    private prisma;
    private redis;
    private jwtService;
    private config;
    private readonly logger;
    private readonly SESSION_TTL_SECONDS;
    private readonly REFRESH_TOKEN_TTL_SECONDS;
    constructor(prisma: PrismaService, redis: RedisService, jwtService: JwtService, config: ConfigService);
    login(email: string, password: string, deviceId: string, userAgent: string, ipAddress: string): Promise<LoginResponse>;
    validateToken(token: string): Promise<AuthPayload>;
    refreshAccessToken(refreshToken: string): Promise<string>;
    logout(sessionId: string): Promise<void>;
    logoutAllDevices(userId: string): Promise<void>;
    verifyKYC(userId: string, kycData: {
        fullName: string;
        documentType: 'AADHAR' | 'PAN' | 'DRIVING_LICENSE';
        documentNumber: string;
        dateOfBirth: string;
    }): Promise<boolean>;
    private validateKYCData;
    register(email: string, password: string, firstName: string, lastName: string, phoneNumber: string): Promise<{
        id: any;
        email: any;
        upiHandle: any;
        message: string;
    }>;
    private isValidEmail;
    private isStrongPassword;
    private generateUniqueUpiHandle;
    private generateAccountNumber;
}
