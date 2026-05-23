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
    /**
     * Authenticate user with email and password
     * Returns JWT tokens and establishes multi-device session
     *
     * @param email User email address
     * @param password Plaintext password (never logged)
     * @param deviceId Device identifier for tracking
     * @param userAgent Client user agent string
     * @param ipAddress Client IP address
     * @returns LoginResponse with access/refresh tokens
     *
     * Throws:
     * - BadRequestException: Invalid email or password
     * - UnauthorizedException: Account suspended or KYC not verified
     */
    login(email: string, password: string, deviceId: string, userAgent: string, ipAddress: string): Promise<LoginResponse>;
    /**
     * Validate JWT token and retrieve payload
     * Checks token signature, expiration, and session validity
     *
     * @param token JWT access token
     * @returns Decoded token payload (AuthPayload)
     *
     * Throws:
     * - UnauthorizedException: Invalid, expired, or revoked token
     */
    validateToken(token: string): Promise<AuthPayload>;
    /**
     * Refresh access token using refresh token
     * Maintains same session, issues new access token
     *
     * @param refreshToken Refresh token from login
     * @returns New access token
     */
    refreshAccessToken(refreshToken: string): Promise<string>;
    /**
     * Logout user by revoking session token
     * Removes session from Redis, blacklists token
     *
     * @param sessionId Session ID to revoke
     */
    logout(sessionId: string): Promise<void>;
    /**
     * Logout user from all devices
     * Revokes all sessions for the user
     *
     * @param userId User ID
     */
    logoutAllDevices(userId: string): Promise<void>;
    /**
     * Verify user KYC status
     * In production, integrate with third-party KYC provider
     *
     * @param userId User ID
     * @param kycData KYC document verification data
     */
    verifyKYC(userId: string, kycData: {
        fullName: string;
        documentType: 'AADHAR' | 'PAN' | 'DRIVING_LICENSE';
        documentNumber: string;
        dateOfBirth: string;
    }): Promise<boolean>;
    private validateKYCData;
    /**
     * Register new user with email and password
     * Generates UPI handle and creates account
     *
     * @param email User email
     * @param password Password (must be 8+ chars, strong)
     * @param firstName First name
     * @param lastName Last name
     * @param phoneNumber Phone number
     * @returns Created user record
     */
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
