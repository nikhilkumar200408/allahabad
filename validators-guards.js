"use strict";
// Core Banking Platform - Input Validators & Authentication Guards
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthGuard_1, OptionalAuthGuard_1, RateLimitGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityHeadersMiddleware = exports.IsValidAmountConstraint = exports.IsUpiHandleConstraint = exports.IdempotencyKey = exports.DeviceId = exports.ClientIp = exports.OptionalUser = exports.CurrentUser = exports.RateLimitGuard = exports.OptionalAuthGuard = exports.AuthGuard = void 0;
exports.validateUpiHandle = validateUpiHandle;
exports.validateIdempotencyKey = validateIdempotencyKey;
exports.validateAmount = validateAmount;
exports.validateEmail = validateEmail;
exports.validatePhoneNumber = validatePhoneNumber;
exports.validateTransactionHash = validateTransactionHash;
exports.validateRRN = validateRRN;
exports.IsUpiHandle = IsUpiHandle;
exports.IsValidAmount = IsValidAmount;
const common_1 = require("@nestjs/common");
const authentication_service_1 = require("./authentication.service");
// ============================================================================
// INPUT VALIDATORS (Zod-like runtime validation)
// ============================================================================
/**
 * Validate UPI handle format: user@mybank
 */
function validateUpiHandle(handle) {
    if (!handle || typeof handle !== 'string') {
        return false;
    }
    const upiRegex = /^[a-zA-Z0-9._-]+@mybank$/;
    return upiRegex.test(handle);
}
/**
 * Validate UUIDv4 format for idempotency keys
 */
function validateIdempotencyKey(key) {
    if (!key || typeof key !== 'string') {
        return false;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(key);
}
/**
 * Validate transaction amount
 * Must be positive, max 6 decimal places
 */
function validateAmount(amount) {
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
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
/**
 * Validate phone number (Indian format)
 */
function validatePhoneNumber(phone) {
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
function validateTransactionHash(hash) {
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
function validateRRN(rrn) {
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
let AuthGuard = AuthGuard_1 = class AuthGuard {
    constructor(authService) {
        this.authService = authService;
        this.logger = new common_1.Logger(AuthGuard_1.name);
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        try {
            // Extract Bearer token from Authorization header
            const authHeader = request.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new common_1.UnauthorizedException('Missing or invalid Authorization header');
            }
            const token = authHeader.substring(7); // Remove "Bearer " prefix
            // Validate token
            const payload = await this.authService.validateToken(token);
            // Attach user to request for later access
            request.user = payload;
            return true;
        }
        catch (error) {
            this.logger.warn(`[AUTH-GUARD-ERROR] ${error.message}`);
            throw new common_1.UnauthorizedException(error.message);
        }
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = AuthGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [authentication_service_1.AuthenticationService])
], AuthGuard);
/**
 * OptionalAuthGuard: Allows authenticated and unauthenticated requests
 * Sets request.user if token is valid, allows request to continue if not
 */
let OptionalAuthGuard = OptionalAuthGuard_1 = class OptionalAuthGuard {
    constructor(authService) {
        this.authService = authService;
        this.logger = new common_1.Logger(OptionalAuthGuard_1.name);
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        try {
            const authHeader = request.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const payload = await this.authService.validateToken(token);
                request.user = payload;
            }
            return true;
        }
        catch (error) {
            // Allow unauthenticated access
            this.logger.debug(`[OPTIONAL-AUTH] Allowing unauthenticated request`);
            return true;
        }
    }
};
exports.OptionalAuthGuard = OptionalAuthGuard;
exports.OptionalAuthGuard = OptionalAuthGuard = OptionalAuthGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [authentication_service_1.AuthenticationService])
], OptionalAuthGuard);
/**
 * RateLimitGuard: Implements token bucket rate limiting
 * Prevents abuse and brute force attacks
 */
let RateLimitGuard = RateLimitGuard_1 = class RateLimitGuard {
    constructor(redis) {
        this.redis = redis;
        this.logger = new common_1.Logger(RateLimitGuard_1.name);
        this.MAX_REQUESTS = 100; // Max requests
        this.WINDOW_SECONDS = 60; // Time window
    } // RedisService
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const clientIp = request.ip || request.socket.remoteAddress || 'UNKNOWN';
        try {
            const key = `ratelimit:${clientIp}`;
            const current = await this.redis.incr(key);
            if (current === 1) {
                // First request in window, set expiry
                await this.redis.expire(key, this.WINDOW_SECONDS);
            }
            if (current > this.MAX_REQUESTS) {
                throw new common_1.BadRequestException(`Rate limit exceeded: ${this.MAX_REQUESTS} requests per ${this.WINDOW_SECONDS} seconds`);
            }
            return true;
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException) {
                throw error;
            }
            this.logger.error(`[RATE-LIMIT-ERROR] ${error.message}`);
            // Fail open: allow request if Redis is unavailable
            return true;
        }
    }
};
exports.RateLimitGuard = RateLimitGuard;
exports.RateLimitGuard = RateLimitGuard = RateLimitGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], RateLimitGuard);
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
exports.CurrentUser = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
});
/**
 * @OptionalUser() - Extract user if authenticated, null otherwise
 */
exports.OptionalUser = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user || null;
});
/**
 * @ClientIp() - Extract client IP address
 * Handles X-Forwarded-For header (for proxied requests)
 */
exports.ClientIp = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    // Check X-Forwarded-For header first (proxied requests)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
        const ips = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : forwardedFor.split(',')[0];
        return ips.trim();
    }
    return request.ip || request.socket.remoteAddress || 'UNKNOWN';
});
/**
 * @DeviceId() - Extract device ID from headers
 */
exports.DeviceId = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['x-device-id'] || 'UNKNOWN';
});
/**
 * @IdempotencyKey() - Extract idempotency key from headers
 */
exports.IdempotencyKey = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['x-idempotency-key'];
});
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
const class_validator_1 = require("class-validator");
let IsUpiHandleConstraint = class IsUpiHandleConstraint {
    validate(value) {
        return validateUpiHandle(value);
    }
    defaultMessage() {
        return 'Invalid UPI handle format. Expected: user@mybank';
    }
};
exports.IsUpiHandleConstraint = IsUpiHandleConstraint;
exports.IsUpiHandleConstraint = IsUpiHandleConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'isUpiHandle', async: false })
], IsUpiHandleConstraint);
function IsUpiHandle(validationOptions) {
    return function (target, propertyName) {
        (0, class_validator_1.registerDecorator)({
            target: target.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsUpiHandleConstraint,
        });
    };
}
let IsValidAmountConstraint = class IsValidAmountConstraint {
    validate(value) {
        return validateAmount(value).valid;
    }
    defaultMessage() {
        return 'Invalid amount. Must be positive with max 6 decimal places.';
    }
};
exports.IsValidAmountConstraint = IsValidAmountConstraint;
exports.IsValidAmountConstraint = IsValidAmountConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'isValidAmount', async: false })
], IsValidAmountConstraint);
function IsValidAmount(validationOptions) {
    return function (target, propertyName) {
        (0, class_validator_1.registerDecorator)({
            target: target.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsValidAmountConstraint,
        });
    };
}
let SecurityHeadersMiddleware = class SecurityHeadersMiddleware {
    use(req, res, next) {
        // Prevent clickjacking
        res.set('X-Frame-Options', 'DENY');
        // Prevent MIME sniffing
        res.set('X-Content-Type-Options', 'nosniff');
        // Enable XSS protection
        res.set('X-XSS-Protection', '1; mode=block');
        // Strict transport security (requires HTTPS)
        res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        // Content security policy
        res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
        // Referrer policy
        res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    }
};
exports.SecurityHeadersMiddleware = SecurityHeadersMiddleware;
exports.SecurityHeadersMiddleware = SecurityHeadersMiddleware = __decorate([
    (0, common_1.Injectable)()
], SecurityHeadersMiddleware);
