// Core Banking Platform - Input Validators & Authentication Guards
/// <reference path="./express.d.ts" />

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  createParamDecorator,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticationService } from './authentication.service';

// ============================================================================
// INPUT VALIDATORS (Zod-like runtime validation)
// ============================================================================

/**
 * Validate UPI handle format: user@mybank
 */
export function validateUpiHandle(handle: string): boolean {
  if (!handle || typeof handle !== 'string') {
    return false;
  }

  const upiRegex = /^[a-zA-Z0-9._-]+@mybank$/;
  return upiRegex.test(handle);
}

/**
 * Validate UUIDv4 format for idempotency keys
 */
export function validateIdempotencyKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(key);
}

/**
 * Validate transaction amount
 * Must be positive, max 6 decimal places
 */
export function validateAmount(amount: any): {
  valid: boolean;
  error?: string;
} {
  if (amount === undefined || amount === null) {
    return { valid: false, error: 'Amount is required' };
  }

  const numAmount = parseFloat(amount.toString());

  if (isNaN(numAmount)) {
    return { valid: false, error: 'Amount must be a valid number' };
  }

  if (numAmount <= 0) {
    return { valid: false, error: 'Amount must be positive' };
  }

  // Check decimal places
  const decimals = (amount.toString().split('.')[1] || '').length;
  if (decimals > 6) {
    return { valid: false, error: 'Amount exceeds 6 decimal places' };
  }

  // Max amount: 999,999.99
  if (numAmount > 999999.99) {
    return { valid: false, error: 'Amount exceeds maximum limit' };
  }

  return { valid: true };
}

/**
 * Validate email address
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number (Indian format)
 */
export function validatePhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  // Match +91XXXXXXXXXX or 91XXXXXXXXXX or XXXXXXXXXX (10 digits)
  const phoneRegex = /^(\+91|91)?[6-9]\d{9}$/;
  return phoneRegex.test(phone);
}

/**
 * Validate transaction hash (0x-prefixed 64-char hex)
 */
export function validateTransactionHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  const hashRegex = /^0x[a-f0-9]{64}$/i;
  return hashRegex.test(hash);
}

/**
 * Validate RRN (UPI Reference Number)
 * Format: YYYY + DDD (day of year) + 6 hex chars
 */
export function validateRRN(rrn: string): boolean {
  if (!rrn || typeof rrn !== 'string') {
    return false;
  }

  const rrnRegex = /^\d{4}\d{3}[A-F0-9]{6}$/;
  return rrnRegex.test(rrn);
}

// ============================================================================
// AUTHENTICATION GUARD
// ============================================================================

/**
 * AuthGuard: Validates JWT token from Authorization header
 * Extracts and verifies token, attaches user to request
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private authService: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    try {
      // Extract Bearer token from Authorization header
      const authHeader = request.headers['authorization'];

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('Missing or invalid Authorization header');
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix

      // Validate token
      const payload = await this.authService.validateToken(token);

      // Attach user to request for later access
      request.user = payload;

      return true;
    } catch (error) {
      this.logger.warn(
        `[AUTH-GUARD-ERROR] ${error.message}`,
      );
      throw new UnauthorizedException(error.message);
    }
  }
}

/**
 * OptionalAuthGuard: Allows authenticated and unauthenticated requests
 * Sets request.user if token is valid, allows request to continue if not
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(private authService: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    try {
      const authHeader = request.headers['authorization'];

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = await this.authService.validateToken(token);
        request.user = payload;
      }

      return true;
    } catch (error) {
      // Allow unauthenticated access
      this.logger.debug(
        `[OPTIONAL-AUTH] Allowing unauthenticated request`,
      );
      return true;
    }
  }
}

/**
 * RateLimitGuard: Implements token bucket rate limiting
 * Prevents abuse and brute force attacks
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly MAX_REQUESTS = 100; // Max requests
  private readonly WINDOW_SECONDS = 60; // Time window

  constructor(private redis: any) {} // RedisService

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = request.ip || request.socket.remoteAddress || 'UNKNOWN';

    try {
      const key = `ratelimit:${clientIp}`;
      const current = await this.redis.incr(key);

      if (current === 1) {
        // First request in window, set expiry
        await this.redis.expire(key, this.WINDOW_SECONDS);
      }

      if (current > this.MAX_REQUESTS) {
        throw new BadRequestException(
          `Rate limit exceeded: ${this.MAX_REQUESTS} requests per ${this.WINDOW_SECONDS} seconds`,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`[RATE-LIMIT-ERROR] ${error.message}`);
      // Fail open: allow request if Redis is unavailable
      return true;
    }
  }
}

// ============================================================================
// CUSTOM DECORATORS
// ============================================================================

/**
 * @CurrentUser() - Extract current user from request
 * Only works within protected endpoints (after AuthGuard)
 * 
 * Usage:
 * ```typescript
 * @Get('/profile')
 * @UseGuards(AuthGuard)
 * getProfile(@CurrentUser() user: AuthPayload) {
 *   // user contains { sub, email, upiHandle, sessionId, deviceId }
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);

/**
 * @OptionalUser() - Extract user if authenticated, null otherwise
 */
export const OptionalUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user || null;
  },
);

/**
 * @ClientIp() - Extract client IP address
 * Handles X-Forwarded-For header (for proxied requests)
 */
export const ClientIp = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();

    // Check X-Forwarded-For header first (proxied requests)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips.trim();
    }

    return request.ip || request.socket.remoteAddress || 'UNKNOWN';
  },
);

/**
 * @DeviceId() - Extract device ID from headers
 */
export const DeviceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['x-device-id'] || 'UNKNOWN';
  },
);

/**
 * @IdempotencyKey() - Extract idempotency key from headers
 */
export const IdempotencyKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['x-idempotency-key'];
  },
);

// ============================================================================
// VALIDATION DECORATORS (Class-validator compatible)
// ============================================================================

/**
 * Usage in DTOs:
 * ```typescript
 * export class TransferDTO {
 *   @IsUpiHandle()
 *   receiverHandle: string;
 * 
 *   @IsValidAmount()
 *   amount: number;
 * }
 * ```
 */
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

@ValidatorConstraint({ name: 'isUpiHandle', async: false })
export class IsUpiHandleConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    return validateUpiHandle(value);
  }

  defaultMessage(): string {
    return 'Invalid UPI handle format. Expected: user@mybank';
  }
}

export function IsUpiHandle(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsUpiHandleConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isValidAmount', async: false })
export class IsValidAmountConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    return validateAmount(value).valid;
  }

  defaultMessage(): string {
    return 'Invalid amount. Must be positive with max 6 decimal places.';
  }
}

export function IsValidAmount(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidAmountConstraint,
    });
  };
}

// ============================================================================
// MIDDLEWARE: REQUEST LOGGING & SECURITY HEADERS
// ============================================================================

import { NestMiddleware } from '@nestjs/common';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: any, next: () => void) {
    // Prevent clickjacking
    res.set('X-Frame-Options', 'DENY');

    // Prevent MIME sniffing
    res.set('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection
    res.set('X-XSS-Protection', '1; mode=block');

    // Strict transport security (requires HTTPS)
    res.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );

    // Content security policy
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    );

    // Referrer policy
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    next();
  }
}
