import { PrismaService } from './prisma.service';
export declare class AccountsController {
    private prisma;
    constructor(prisma: PrismaService);
    list(userId: string): Promise<{
        data: {
            id: string;
            accountNumber: string;
            currency: string;
            currentBalance: import("@prisma/client/runtime/library").Decimal;
        }[];
    }>;
}
