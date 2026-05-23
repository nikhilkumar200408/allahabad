import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticationService } from './authentication.service';
/**
 * Validate UPI handle format: user@mybank
 */
export declare function validateUpiHandle(handle: string): boolean;
/**
 * Validate UUIDv4 format for idempotency keys
 */
export declare function validateIdempotencyKey(key: string): boolean;
/**
 * Validate transaction amount
 * Must be positive, max 6 decimal places
 */
export declare function validateAmount(amount: any): {
    valid: boolean;
    error?: string;
};
/**
 * Validate email address
 */
export declare function validateEmail(email: string): boolean;
/**
 * Validate phone number (Indian format)
 */
export declare function validatePhoneNumber(phone: string): boolean;
/**
 * Validate transaction hash (0x-prefixed 64-char hex)
 */
export declare function validateTransactionHash(hash: string): boolean;
/**
 * Validate RRN (UPI Reference Number)
 * Format: YYYY + DDD (day of year) + 6 hex chars
 */
export declare function validateRRN(rrn: string): boolean;
/**
 * AuthGuard: Validates JWT token from Authorization header
 * Extracts and verifies token, attaches user to request
 */
export declare class AuthGuard implements CanActivate {
    private authService;
    private readonly logger;
    constructor(authService: AuthenticationService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
/**
 * OptionalAuthGuard: Allows authenticated and unauthenticated requests
 * Sets request.user if token is valid, allows request to continue if not
 */
export declare class OptionalAuthGuard implements CanActivate {
    private authService;
    private readonly logger;
    constructor(authService: AuthenticationService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
/**
 * RateLimitGuard: Implements token bucket rate limiting
 * Prevents abuse and brute force attacks
 */
export declare class RateLimitGuard implements CanActivate {
    private redis;
    private readonly logger;
    private readonly MAX_REQUESTS;
    private readonly WINDOW_SECONDS;
    constructor(redis: any);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
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
export declare const CurrentUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
/**
 * @OptionalUser() - Extract user if authenticated, null otherwise
 */
export declare const OptionalUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
/**
 * @ClientIp() - Extract client IP address
 * Handles X-Forwarded-For header (for proxied requests)
 */
export declare const ClientIp: (...dataOrPipes: unknown[]) => ParameterDecorator;
/**
 * @DeviceId() - Extract device ID from headers
 */
export declare const DeviceId: (...dataOrPipes: unknown[]) => ParameterDecorator;
/**
 * @IdempotencyKey() - Extract idempotency key from headers
 */
export declare const IdempotencyKey: (...dataOrPipes: unknown[]) => ParameterDecorator;
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
import { ValidatorConstraintInterface, ValidationOptions } from 'class-validator';
export declare class IsUpiHandleConstraint implements ValidatorConstraintInterface {
    validate(value: any): boolean;
    defaultMessage(): string;
}
export declare function IsUpiHandle(validationOptions?: ValidationOptions): (target: Object, propertyName: string) => void;
export declare class IsValidAmountConstraint implements ValidatorConstraintInterface {
    validate(value: any): boolean;
    defaultMessage(): string;
}
export declare function IsValidAmount(validationOptions?: ValidationOptions): (target: Object, propertyName: string) => void;
import { NestMiddleware } from '@nestjs/common';
export declare class SecurityHeadersMiddleware implements NestMiddleware {
    use(req: Request, res: any, next: () => void): void;
}
