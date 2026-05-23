import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { BlockchainService } from './blockchain.service';
type ISO8601String = string;
export interface UpiPaymentRequest {
    senderId: string;
    receiverUpiHandle: string;
    amount: number;
    description: string;
    idempotencyKey: string;
}
export interface UpiPaymentResult {
    success: boolean;
    transactionId: string;
    rrn: string;
    txHash: string;
    blockchainStatus: 'PENDING' | 'ANCHORED' | 'FAILED';
    message: string;
    timestamp: ISO8601String;
}
export declare class UpiPaymentService {
    private readonly prisma;
    private readonly redis;
    private readonly blockchain;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, redis: RedisService, blockchain: BlockchainService, config: ConfigService);
    processUpiPayment(request: UpiPaymentRequest): Promise<UpiPaymentResult>;
    private idempotencyResultKey;
    private idempotencySentinelKey;
    private lookupIdempotencyResult;
    private acquireIdempotencySentinel;
    private storeIdempotencyResult;
    private clearIdempotencySentinel;
    private sortedLockKeys;
    private acquireLocksWithTimeout;
    private releaseAllLocks;
    private lockAccountRows;
    private resolveSenderAccount;
    private resolveReceiverAccount;
    private anchorToBlockchainLedger;
    private mockBlockchainAnchor;
    private enqueueBlockchainRetry;
    private markTransactionRolledBack;
    private classifyAndWrapError;
    private validateRequest;
    private generateRrn;
    private generateTxHash;
    private isValidUuidV4;
    private sleep;
}
export {};
