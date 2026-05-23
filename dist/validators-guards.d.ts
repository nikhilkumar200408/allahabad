import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticationService } from './authentication.service';
export declare function validateUpiHandle(handle: string): boolean;
export declare function validateIdempotencyKey(key: string): boolean;
export declare function validateAmount(amount: any): {
    valid: boolean;
    error?: string;
};
export declare function validateEmail(email: string): boolean;
export declare function validatePhoneNumber(phone: string): boolean;
export declare function validateTransactionHash(hash: string): boolean;
export declare function validateRRN(rrn: string): boolean;
export declare class AuthGuard implements CanActivate {
    private authService;
    private readonly logger;
    constructor(authService: AuthenticationService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class OptionalAuthGuard implements CanActivate {
    private authService;
    private readonly logger;
    constructor(authService: AuthenticationService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class RateLimitGuard implements CanActivate {
    private redis;
    private readonly logger;
    private readonly MAX_REQUESTS;
    private readonly WINDOW_SECONDS;
    constructor(redis: any);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare const CurrentUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const OptionalUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const ClientIp: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const DeviceId: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const IdempotencyKey: (...dataOrPipes: unknown[]) => ParameterDecorator;
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
