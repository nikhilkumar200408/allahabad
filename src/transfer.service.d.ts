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
    timestamp: ISO8601String;
}
export declare class TransferService {
    private prisma;
    private redis;
    private blockchain;
    private readonly logger;
    private readonly LOCK_TIMEOUT_MS;
    private readonly IDEMPOTENCY_WINDOW_SEC;
    constructor(prisma: PrismaService, redis: RedisService, blockchain: BlockchainService);
    /**
     * Execute a peer-to-peer UPI transfer with full ACID guarantees
     *
     * Security layers:
     * 1. Idempotency check (Redis cache, 120-second window)
     * 2. Distributed lock on both accounts (Redlock algorithm)
     * 3. Double-entry bookkeeping within database transaction
     * 4. Blockchain anchor with hash verification
     * 5. Full rollback on any failure
     */
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
