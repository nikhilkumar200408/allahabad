import { AuthenticationService } from './authentication.service';
import { Request } from 'express';
import { PrismaService } from './prisma.service';
export declare class AuthController {
    private authService;
    private prisma;
    constructor(authService: AuthenticationService, prisma: PrismaService);
    register(body: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        phoneNumber: string;
    }): Promise<{
        id: any;
        email: any;
        upiHandle: any;
        message: string;
    }>;
    login(body: {
        email: string;
        password: string;
        deviceId?: string;
    }, request: Request): Promise<import("./authentication.service").LoginResponse>;
    refresh(body: {
        refreshToken: string;
    }): Promise<{
        accessToken: string;
    }>;
    me(userId: string): Promise<{
        user: {
            id: string;
            email: string;
            upiHandle: string;
            kycStatus: import(".prisma/client").$Enums.KycStatus;
        };
        account: {
            id: string;
            currency: string;
            currentBalance: import("@prisma/client/runtime/library").Decimal;
        };
    }>;
    verifyKYC(userId: string, body: {
        fullName: string;
        documentType: 'AADHAR' | 'PAN' | 'DRIVING_LICENSE';
        documentNumber: string;
        dateOfBirth: string;
    }): Promise<boolean>;
}
