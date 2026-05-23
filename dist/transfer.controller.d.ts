import { TransferService, TransferResponse } from './transfer.service';
import { BlockchainService } from './blockchain.service';
import { PrismaService } from './prisma.service';
export declare class InitiateTransferDTO {
    receiverHandle: string;
    amount: number;
    description?: string;
}
export declare class VerifyTransactionDTO {
    txHash: string;
}
export declare class TransactionHistoryQueryDTO {
    page?: number;
    limit?: number;
    status?: 'PENDING' | 'SETTLED' | 'FAILED';
    direction?: 'SENT' | 'RECEIVED';
}
export declare class TransferController {
    private transferService;
    private blockchainService;
    private prisma;
    private readonly logger;
    constructor(transferService: TransferService, blockchainService: BlockchainService, prisma: PrismaService);
    initiateTransfer(currentUser: any, dto: InitiateTransferDTO, idempotencyKey: string, deviceId: string, userAgent: string, clientIp?: string): Promise<TransferResponse>;
    getTransaction(currentUser: any, transactionId: string): Promise<{
        amount: string;
        sender: {
            id: string;
            upiHandle: string;
            firstName: string;
            lastName: string;
        };
        receiver: {
            id: string;
            upiHandle: string;
            firstName: string;
            lastName: string;
        };
        blockchainAudit: {
            id: string;
            txHash: string;
            previousHash: string | null;
            blockNumber: bigint | null;
            transactionId: string;
            blockHash: string | null;
            gasUsed: bigint | null;
            smartContractAddr: string;
            eventSignature: string;
            verificationStatus: import(".prisma/client").$Enums.VerificationStatus;
            verifiedAt: Date | null;
            verificationProof: string | null;
            anchoredAt: Date;
            syncedToChainAt: Date | null;
        };
        description: string;
        id: string;
        createdAt: Date;
        currency: string;
        status: import(".prisma/client").$Enums.TransactionStatus;
        txHash: string | null;
        rrn: string;
        idempotencyKey: string;
        senderId: string;
        senderAccountId: string;
        receiverId: string;
        receiverAccountId: string;
        transactionType: import(".prisma/client").$Enums.TransactionType;
        blockchainStatus: import(".prisma/client").$Enums.BlockchainStatus;
        blockchainTxId: string | null;
        blockedAt: Date | null;
        errorReason: string | null;
        failureRetries: number;
        settledAt: Date | null;
    }>;
    getTransactionByRrn(currentUser: any, rrn: string): Promise<{
        amount: string;
        sender: {
            id: string;
            upiHandle: string;
        };
        receiver: {
            id: string;
            upiHandle: string;
        };
        blockchainAudit: {
            id: string;
            txHash: string;
            previousHash: string | null;
            blockNumber: bigint | null;
            transactionId: string;
            blockHash: string | null;
            gasUsed: bigint | null;
            smartContractAddr: string;
            eventSignature: string;
            verificationStatus: import(".prisma/client").$Enums.VerificationStatus;
            verifiedAt: Date | null;
            verificationProof: string | null;
            anchoredAt: Date;
            syncedToChainAt: Date | null;
        };
        description: string;
        id: string;
        createdAt: Date;
        currency: string;
        status: import(".prisma/client").$Enums.TransactionStatus;
        txHash: string | null;
        rrn: string;
        idempotencyKey: string;
        senderId: string;
        senderAccountId: string;
        receiverId: string;
        receiverAccountId: string;
        transactionType: import(".prisma/client").$Enums.TransactionType;
        blockchainStatus: import(".prisma/client").$Enums.BlockchainStatus;
        blockchainTxId: string | null;
        blockedAt: Date | null;
        errorReason: string | null;
        failureRetries: number;
        settledAt: Date | null;
    }>;
    verifyOnBlockchain(currentUser: any, dto: VerifyTransactionDTO): Promise<{
        verified: boolean;
        blockNumber: number;
        chainproof: any;
    }>;
    getTransactionHistory(currentUser: any, query: TransactionHistoryQueryDTO): Promise<{
        data: {
            amount: string;
            sender: {
                upiHandle: string;
            };
            receiver: {
                upiHandle: string;
            };
            description: string;
            id: string;
            createdAt: Date;
            currency: string;
            status: import(".prisma/client").$Enums.TransactionStatus;
            txHash: string | null;
            rrn: string;
            idempotencyKey: string;
            senderId: string;
            senderAccountId: string;
            receiverId: string;
            receiverAccountId: string;
            transactionType: import(".prisma/client").$Enums.TransactionType;
            blockchainStatus: import(".prisma/client").$Enums.BlockchainStatus;
            blockchainTxId: string | null;
            blockedAt: Date | null;
            errorReason: string | null;
            failureRetries: number;
            settledAt: Date | null;
        }[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            pages: number;
        };
    }>;
    private trackDeviceSession;
    private hashDeviceToken;
    private inferDeviceType;
}
