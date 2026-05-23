import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { BlockchainService } from './blockchain.service';
export interface TransferRequest {
    senderId: string;
    receiverHandle: string;
    amount: number;
    description: string;
    idempotencyKey: string;
}
export interface TransferResponse {
    success: boolean;
    transactionId: string;
    rrn: string;
    txHash?: string;
    blockchainStatus: string;
    message: string;
    timestamp: string;
}
export declare class TransferService {
    private prisma;
    private redis;
    private blockchain;
    private readonly logger;
    private readonly LOCK_TIMEOUT_MS;
    private readonly IDEMPOTENCY_WINDOW_SEC;
    constructor(prisma: PrismaService, redis: RedisService, blockchain: BlockchainService);
    executeTransfer(request: TransferRequest): Promise<TransferResponse>;
    private checkIdempotency;
    private cacheIdempotencyResponse;
    private sortLockKeys;
    private acquireDistributedLocks;
    private releaseDistributedLocks;
    private getLockedBalance;
    private validateTransferRequest;
    private generateTransactionHash;
    private generateRRN;
    private getDayOfYear;
    private submitBlockchainAnchor;
    private isValidUUID;
    private isRecoverableError;
}
