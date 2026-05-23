"use strict";
// Core Banking Platform - Authentication & Session Service
// JWT generation, multi-device session tracking, KYC verification
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
var AuthenticationService_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthenticationService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const config_1 = require("@nestjs/config");
const bcrypt = __importStar(require("bcrypt"));
const crypto = __importStar(require("crypto"));
const uuid_1 = require("uuid");
// ============================================================================
// AUTHENTICATION SERVICE
// ============================================================================
let AuthenticationService = AuthenticationService_1 = class AuthenticationService {
    constructor(prisma, redis, jwtService, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.jwtService = jwtService;
        this.config = config;
        this.logger = new common_1.Logger(AuthenticationService_1.name);
        this.SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
        this.REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
    }
    // =========================================================================
    // LOGIN: EMAIL + PASSWORD WITH MULTI-DEVICE SUPPORT
    // =========================================================================
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
    async login(email, password, deviceId, userAgent, ipAddress) {
        this.logger.log(`[LOGIN-ATTEMPT] Email: ${email}, Device: ${deviceId}`);
        // =========================================================================
        // STEP 1: VALIDATE INPUT
        // =========================================================================
        if (!email || !password) {
            throw new common_1.BadRequestException('Email and password are required');
        }
        if (password.length < 8) {
            throw new common_1.BadRequestException('Password must be at least 8 characters');
        }
        // =========================================================================
        // STEP 2: FETCH USER BY EMAIL
        // =========================================================================
        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                upiHandle: true,
                passwordHash: true,
                kycStatus: true,
                createdAt: true,
            },
        });
        if (!user) {
            // Hash password anyway to prevent timing attacks
            await bcrypt.compare(password, '$2b$10$invalid.hash.0000000000000000000');
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // =========================================================================
        // STEP 3: VERIFY PASSWORD
        // =========================================================================
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            this.logger.warn(`[LOGIN-FAILED] Invalid password for ${email}`);
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        // =========================================================================
        // STEP 4: CHECK KYC STATUS
        // =========================================================================
        if (user.kycStatus !== 'VERIFIED') {
            throw new common_1.UnauthorizedException(`Account KYC status is ${user.kycStatus}. Please complete KYC verification.`);
        }
        // =========================================================================
        // STEP 5: CREATE SESSION RECORD
        // =========================================================================
        const sessionId = (0, uuid_1.v4)();
        const tokenHash = crypto
            .createHash('sha256')
            .update(sessionId)
            .digest('hex');
        const expiresAt = new Date(Date.now() + this.SESSION_TTL_SECONDS * 1000);
        await this.prisma.session.create({
            data: {
                userId: user.id,
                tokenHash,
                userAgent,
                ipAddress,
                deviceId,
                expiresAt,
            },
        });
        this.logger.log(`[SESSION-CREATED] User: ${user.id}, Session: ${sessionId}`);
        // =========================================================================
        // STEP 6: GENERATE JWT TOKENS
        // =========================================================================
        const accessToken = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            upiHandle: user.upiHandle,
            sessionId,
            deviceId,
        }, {
            expiresIn: `${Math.floor(this.SESSION_TTL_SECONDS / 60)}m`,
            issuer: 'banking-platform',
            audience: 'banking-platform-api',
        });
        const refreshToken = this.jwtService.sign({
            sub: user.id,
            sessionId,
            type: 'refresh',
        }, {
            expiresIn: `${Math.floor(this.REFRESH_TOKEN_TTL_SECONDS / 60)}m`,
            issuer: 'banking-platform',
        });
        // =========================================================================
        // STEP 7: CACHE TOKENS IN REDIS (for blacklist/revocation)
        // =========================================================================
        await this.redis.setex(`session:${sessionId}`, this.SESSION_TTL_SECONDS, JSON.stringify({
            userId: user.id,
            tokenHash,
            deviceId,
            ipAddress,
            createdAt: new Date().toISOString(),
        }));
        this.logger.log(`[LOGIN-SUCCESS] User: ${user.id}`);
        return {
            accessToken,
            refreshToken,
            expiresIn: this.SESSION_TTL_SECONDS,
            user: {
                id: user.id,
                email: user.email,
                upiHandle: user.upiHandle,
                kycStatus: user.kycStatus,
            },
        };
    }
    // =========================================================================
    // VALIDATE JWT TOKEN
    // =========================================================================
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
    async validateToken(token) {
        try {
            const payload = this.jwtService.verify(token);
            // Check if session exists in Redis (not revoked)
            const sessionData = await this.redis.get(`session:${payload.sessionId}`);
            if (!sessionData) {
                throw new common_1.UnauthorizedException('Session expired or revoked');
            }
            // Verify user still exists in database
            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
                select: { id: true, kycStatus: true },
            });
            if (!user) {
                throw new common_1.UnauthorizedException('User not found');
            }
            if (user.kycStatus !== 'VERIFIED') {
                throw new common_1.UnauthorizedException('Account KYC status invalid');
            }
            return payload;
        }
        catch (error) {
            this.logger.warn(`[TOKEN-VALIDATION-ERROR] ${error.message}`);
            throw new common_1.UnauthorizedException(`Invalid token: ${error.message}`);
        }
    }
    // =========================================================================
    // REFRESH TOKEN
    // =========================================================================
    /**
     * Refresh access token using refresh token
     * Maintains same session, issues new access token
     *
     * @param refreshToken Refresh token from login
     * @returns New access token
     */
    async refreshAccessToken(refreshToken) {
        try {
            const payload = this.jwtService.verify(refreshToken);
            if (payload.type !== 'refresh') {
                throw new common_1.UnauthorizedException('Invalid token type');
            }
            // Verify session still exists
            const sessionData = await this.redis.get(`session:${payload.sessionId}`);
            if (!sessionData) {
                throw new common_1.UnauthorizedException('Session expired');
            }
            const session = JSON.parse(sessionData);
            // Issue new access token
            const newAccessToken = this.jwtService.sign({
                sub: payload.sub,
                sessionId: payload.sessionId,
                deviceId: session.deviceId,
            }, {
                expiresIn: `${Math.floor(this.SESSION_TTL_SECONDS / 60)}m`,
            });
            return newAccessToken;
        }
        catch (error) {
            this.logger.warn(`[REFRESH-TOKEN-ERROR] ${error.message}`);
            throw new common_1.UnauthorizedException(`Refresh failed: ${error.message}`);
        }
    }
    // =========================================================================
    // LOGOUT: REVOKE SESSION
    // =========================================================================
    /**
     * Logout user by revoking session token
     * Removes session from Redis, blacklists token
     *
     * @param sessionId Session ID to revoke
     */
    async logout(sessionId) {
        try {
            // Delete session from Redis
            await this.redis.del(`session:${sessionId}`);
            // Add token to blacklist (optional, for extra security)
            await this.redis.setex(`blacklist:${sessionId}`, this.SESSION_TTL_SECONDS, '1');
            this.logger.log(`[LOGOUT] Session revoked: ${sessionId}`);
        }
        catch (error) {
            this.logger.error(`[LOGOUT-ERROR] ${error.message}`);
            throw error;
        }
    }
    // =========================================================================
    // LOGOUT ALL DEVICES
    // =========================================================================
    /**
     * Logout user from all devices
     * Revokes all sessions for the user
     *
     * @param userId User ID
     */
    async logoutAllDevices(userId) {
        try {
            // Find all sessions for user
            const sessions = await this.prisma.session.findMany({
                where: {
                    userId,
                    revokedAt: null,
                },
                select: { id: true },
            });
            // Revoke all sessions
            await this.prisma.session.updateMany({
                where: { userId },
                data: { revokedAt: new Date() },
            });
            // Delete from Redis
            for (const session of sessions) {
                await this.redis.del(`session:${session.id}`);
            }
            this.logger.log(`[LOGOUT-ALL-DEVICES] User: ${userId}`);
        }
        catch (error) {
            this.logger.error(`[LOGOUT-ALL-DEVICES-ERROR] ${error.message}`);
            throw error;
        }
    }
    // =========================================================================
    // KYC VERIFICATION
    // =========================================================================
    /**
     * Verify user KYC status
     * In production, integrate with third-party KYC provider
     *
     * @param userId User ID
     * @param kycData KYC document verification data
     */
    async verifyKYC(userId, kycData) {
        try {
            this.logger.log(`[KYC-VERIFY] User: ${userId}`);
            // Validate document format
            this.validateKYCData(kycData);
            // In production: Call third-party KYC API (e.g., Aadhaar UIDAI)
            // For simulation, always return true
            const isVerified = Math.random() < 0.95; // 95% success rate
            if (isVerified) {
                await this.prisma.user.update({
                    where: { id: userId },
                    data: {
                        kycStatus: 'VERIFIED',
                        kycVerifiedAt: new Date(),
                    },
                });
                this.logger.log(`[KYC-VERIFIED] User: ${userId}`);
                return true;
            }
            else {
                await this.prisma.user.update({
                    where: { id: userId },
                    data: {
                        kycStatus: 'REJECTED',
                    },
                });
                this.logger.log(`[KYC-REJECTED] User: ${userId}`);
                return false;
            }
        }
        catch (error) {
            this.logger.error(`[KYC-VERIFY-ERROR] ${error.message}`);
            throw error;
        }
    }
    validateKYCData(data) {
        if (!data.fullName || data.fullName.length < 3) {
            throw new common_1.BadRequestException('Full name is required (min 3 chars)');
        }
        if (!data.documentType) {
            throw new common_1.BadRequestException('Document type is required');
        }
        if (!data.documentNumber) {
            throw new common_1.BadRequestException('Document number is required');
        }
        if (!data.dateOfBirth) {
            throw new common_1.BadRequestException('Date of birth is required');
        }
        // Verify age >= 18
        const dob = new Date(data.dateOfBirth);
        const age = new Date().getFullYear() - dob.getFullYear();
        if (age < 18) {
            throw new common_1.BadRequestException('User must be at least 18 years old');
        }
    }
    // =========================================================================
    // REGISTER NEW USER
    // =========================================================================
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
    async register(email, password, firstName, lastName, phoneNumber) {
        this.logger.log(`[REGISTER] Email: ${email}`);
        // Validate inputs
        if (!this.isValidEmail(email)) {
            throw new common_1.BadRequestException('Invalid email format');
        }
        if (!this.isStrongPassword(password)) {
            throw new common_1.BadRequestException('Password must contain uppercase, lowercase, number, and symbol');
        }
        // Check if user exists
        const existing = await this.prisma.user.findUnique({
            where: { email },
        });
        if (existing) {
            throw new common_1.BadRequestException('Email already registered');
        }
        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);
        // Generate unique UPI handle
        const upiHandle = await this.generateUniqueUpiHandle(firstName, lastName);
        // Create user
        const user = await this.prisma.user.create({
            data: {
                email,
                passwordHash,
                firstName,
                lastName,
                phoneNumber,
                upiHandle,
                kycStatus: 'PENDING',
                accounts: {
                    create: {
                        accountNumber: this.generateAccountNumber(),
                        accountType: 'SAVINGS',
                        currency: 'MYSIM',
                        currentBalance: 10000, // Starting balance for simulation
                    },
                },
            },
        });
        this.logger.log(`[REGISTER-SUCCESS] User: ${user.id}`);
        return {
            id: user.id,
            email: user.email,
            upiHandle: user.upiHandle,
            message: 'Registration successful. Please complete KYC verification.',
        };
    }
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    isStrongPassword(password) {
        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumber = /\d/.test(password);
        const hasSymbol = /[!@#$%^&*]/.test(password);
        return (password.length >= 8 &&
            hasUppercase &&
            hasLowercase &&
            hasNumber &&
            hasSymbol);
    }
    async generateUniqueUpiHandle(firstName, lastName) {
        let baseHandle = `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
        baseHandle = baseHandle.substring(0, 20); // Max 20 chars
        let upiHandle = `${baseHandle}@mybank`;
        let counter = 1;
        while (true) {
            const existing = await this.prisma.user.findUnique({
                where: { upiHandle },
            });
            if (!existing) {
                return upiHandle;
            }
            upiHandle = `${baseHandle}${counter}@mybank`;
            counter++;
        }
    }
    generateAccountNumber() {
        const prefix = '11'; // Bank code
        const random = crypto.randomBytes(6).toString('hex').toUpperCase();
        return `${prefix}${Date.now()}${random}`.substring(0, 18);
    }
};
exports.AuthenticationService = AuthenticationService;
exports.AuthenticationService = AuthenticationService = AuthenticationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof prisma_service_1.PrismaService !== "undefined" && prisma_service_1.PrismaService) === "function" ? _a : Object, redis_service_1.RedisService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthenticationService);
