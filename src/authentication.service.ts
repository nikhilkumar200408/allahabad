// Core Banking Platform - Authentication & Session Service
// JWT generation, multi-device session tracking, KYC verification

import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface AuthPayload {
  sub: string; // User ID (subject)
  email: string;
  upiHandle: string;
  sessionId: string; // Session ID for tracking
  deviceId: string;
  iat: number; // Issued at
  exp: number; // Expiration
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

// ============================================================================
// AUTHENTICATION SERVICE
// ============================================================================

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
  private readonly REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

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
  async login(
    email: string,
    password: string,
    deviceId: string,
    userAgent: string,
    ipAddress: string,
  ): Promise<LoginResponse> {
    this.logger.log(`[LOGIN-ATTEMPT] Email: ${email}, Device: ${deviceId}`);

    // =========================================================================
    // STEP 1: VALIDATE INPUT
    // =========================================================================
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    if (password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters',
      );
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
      throw new UnauthorizedException('Invalid email or password');
    }

    // =========================================================================
    // STEP 3: VERIFY PASSWORD
    // =========================================================================
    const isPasswordValid = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      this.logger.warn(`[LOGIN-FAILED] Invalid password for ${email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // =========================================================================
    // STEP 4: CHECK KYC STATUS
    // =========================================================================
    const allowedLoginStatuses = ['PENDING', 'REJECTED', 'VERIFIED'];
    if (!allowedLoginStatuses.includes(user.kycStatus)) {
      throw new UnauthorizedException(
        `Account KYC status is ${user.kycStatus}. Please contact support.`,
      );
    }

    // =========================================================================
    // STEP 5: CREATE SESSION RECORD
    // =========================================================================
    const sessionId = uuidv4();
    const tokenHash = crypto
      .createHash('sha256')
      .update(sessionId)
      .digest('hex');

    const expiresAt = new Date(
      Date.now() + this.SESSION_TTL_SECONDS * 1000,
    );

    await this.prisma.session.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId,
        },
      },
      create: {
        userId: user.id,
        tokenHash,
        userAgent,
        ipAddress,
        deviceId,
        expiresAt,
      },
      update: {
        tokenHash,
        userAgent,
        ipAddress,
        expiresAt,
      },
    });
    this.logger.log(
      `[SESSION-CREATED] User: ${user.id}, Session: ${sessionId}`,
    );

    // =========================================================================
    // STEP 6: GENERATE JWT TOKENS
    // =========================================================================
    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        upiHandle: user.upiHandle,
        sessionId,
        deviceId,
      },
      {
        expiresIn: `${Math.floor(this.SESSION_TTL_SECONDS / 60)}m`,
        issuer: 'banking-platform',
        audience: 'banking-platform-api',
      },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        sessionId,
        type: 'refresh',
      },
      {
        expiresIn: `${Math.floor(this.REFRESH_TOKEN_TTL_SECONDS / 60)}m`,
        issuer: 'banking-platform',
      },
    );

    // =========================================================================
    // STEP 7: CACHE TOKENS IN REDIS (for blacklist/revocation)
    // =========================================================================
    await this.redis.setex(
      `session:${sessionId}`,
      this.SESSION_TTL_SECONDS,
      JSON.stringify({
        userId: user.id,
        tokenHash,
        deviceId,
        ipAddress,
        createdAt: new Date().toISOString(),
      }),
    );

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
  async validateToken(token: string): Promise<AuthPayload> {
    try {
      const payload = this.jwtService.verify(token);

      // Check if session exists in Redis (not revoked)
      const sessionData = await this.redis.get(
        `session:${payload.sessionId}`,
      );

      if (!sessionData) {
        throw new UnauthorizedException('Session expired or revoked');
      }

      // Verify user still exists in database
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, kycStatus: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (user.kycStatus !== 'VERIFIED') {
        throw new UnauthorizedException('Account KYC status invalid');
      }

      return payload as AuthPayload;
    } catch (error) {
      this.logger.warn(`[TOKEN-VALIDATION-ERROR] ${error.message}`);
      throw new UnauthorizedException(`Invalid token: ${error.message}`);
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
  async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const payload = this.jwtService.verify(refreshToken);

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // Verify session still exists
      const sessionData = await this.redis.get(
        `session:${payload.sessionId}`,
      );

      if (!sessionData) {
        throw new UnauthorizedException('Session expired');
      }

      const session = JSON.parse(sessionData);

      // Issue new access token
      const newAccessToken = this.jwtService.sign(
        {
          sub: payload.sub,
          sessionId: payload.sessionId,
          deviceId: session.deviceId,
        },
        {
          expiresIn: `${Math.floor(this.SESSION_TTL_SECONDS / 60)}m`,
        },
      );

      return newAccessToken;
    } catch (error) {
      this.logger.warn(`[REFRESH-TOKEN-ERROR] ${error.message}`);
      throw new UnauthorizedException(`Refresh failed: ${error.message}`);
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
  async logout(sessionId: string): Promise<void> {
    try {
      // Delete session from Redis
      await this.redis.del(`session:${sessionId}`);

      // Add token to blacklist (optional, for extra security)
      await this.redis.setex(
        `blacklist:${sessionId}`,
        this.SESSION_TTL_SECONDS,
        '1',
      );

      this.logger.log(`[LOGOUT] Session revoked: ${sessionId}`);
    } catch (error) {
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
  async logoutAllDevices(userId: string): Promise<void> {
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
    } catch (error) {
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
  async verifyKYC(
    userId: string,
    kycData: {
      fullName: string;
      documentType: 'AADHAR' | 'PAN' | 'DRIVING_LICENSE';
      documentNumber: string;
      dateOfBirth: string;
    },
  ): Promise<boolean> {
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
      } else {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            kycStatus: 'REJECTED',
          },
        });

        this.logger.log(`[KYC-REJECTED] User: ${userId}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`[KYC-VERIFY-ERROR] ${error.message}`);
      throw error;
    }
  }

  private validateKYCData(data: any): void {
    if (!data.fullName || data.fullName.length < 3) {
      throw new BadRequestException('Full name is required (min 3 chars)');
    }

    if (!data.documentType) {
      throw new BadRequestException('Document type is required');
    }

    if (!data.documentNumber) {
      throw new BadRequestException('Document number is required');
    }

    if (!data.dateOfBirth) {
      throw new BadRequestException('Date of birth is required');
    }

    // Verify age >= 18
    const dob = new Date(data.dateOfBirth);
    const age = new Date().getFullYear() - dob.getFullYear();

    if (age < 18) {
      throw new BadRequestException('User must be at least 18 years old');
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
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phoneNumber: string,
  ) {
    this.logger.log(`[REGISTER] Email: ${email}`);

    // Validate inputs
    if (!this.isValidEmail(email)) {
      throw new BadRequestException('Invalid email format');
    }

    if (!this.isStrongPassword(password)) {
      throw new BadRequestException(
        'Password must contain uppercase, lowercase, number, and symbol',
      );
    }

    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    // Check phone number uniqueness (DB has unique constraint)
    if (phoneNumber) {
      const byPhone = await this.prisma.user.findUnique({
        where: { phoneNumber },
      });
      if (byPhone) {
        throw new BadRequestException('Phone number already registered');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate unique UPI handle
    const upiHandle = await this.generateUniqueUpiHandle(firstName, lastName);

    // Create user
    let user;
    try {
      user = await this.prisma.user.create({
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
    } catch (err) {
      // Convert Prisma unique-constraint or other DB errors to BadRequest where appropriate
      if (err?.code === 'P2002' && err?.meta?.target?.includes('phoneNumber')) {
        throw new BadRequestException('Phone number already registered');
      }
      this.logger.error(`[REGISTER-ERROR] ${err.message}`);
      throw err;
    }

    this.logger.log(`[REGISTER-SUCCESS] User: ${user.id}`);

    return {
      id: user.id,
      email: user.email,
      upiHandle: user.upiHandle,
      message: 'Registration successful. Please complete KYC verification.',
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isStrongPassword(password: string): boolean {
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSymbol = /[!@#$%^&*]/.test(password);

    return (
      password.length >= 8 &&
      hasUppercase &&
      hasLowercase &&
      hasNumber &&
      hasSymbol
    );
  }

  private async generateUniqueUpiHandle(
    firstName: string,
    lastName: string,
  ): Promise<string> {
    let baseHandle = `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(
      /[^a-z0-9]/g,
      '',
    );

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

  private generateAccountNumber(): string {
    const prefix = '11'; // Bank code
    const random = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${prefix}${Date.now()}${random}`.substring(0, 18);
  }
}
