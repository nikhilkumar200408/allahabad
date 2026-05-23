import { TransferService, TransferResponse } from './transfer.service';
import { BlockchainService } from './blockchain.service';
import { PrismaService } from './prisma.service';
export declare class InitiateTransferDTO {
    /**
     * Receiver UPI handle (e.g., user@mybank)
     * Required, must be valid UPI format
     */
    receiverHandle: string;
    /**
     * Transfer amount in MYSIM (min: 0.01, max: 999,999.99)
     * Must be positive decimal with max 6 decimal places
     */
    amount: number;
    /**
     * Optional description/reference for the transaction
     * Max 500 characters
     */
    description?: string;
}
export declare class VerifyTransactionDTO {
    /**
     * Transaction hash (0x-prefixed 64-char hex)
     * Used for blockchain verification
     */
    txHash: string;
}
export declare class TransactionHistoryQueryDTO {
    /**
     * Pagination: page number (1-indexed)
     */
    page?: number;
    /**
     * Items per page (max 50)
     */
    limit?: number;
    /**
     * Filter by transaction status
     */
    status?: 'PENDING' | 'SETTLED' | 'FAILED';
    /**
     * Filter by direction (sent/received)
     */
    direction?: 'SENT' | 'RECEIVED';
}
export declare class TransferController {
    private transferService;
    private blockchainService;
    private prisma;
    private readonly logger;
    constructor(transferService: TransferService, blockchainService: BlockchainService, prisma: PrismaService);
    /**
     * Initiate a peer-to-peer UPI transfer
     *
     * Security features:
     * - JWT authentication (Authorization header)
     * - X-Idempotency-Key header for idempotent submission
     * - X-Device-ID header for device tracking
     * - IP-based fraud detection
     * - Rate limiting (Thrift)
     *
     * @param currentUser Authenticated user from JWT
     * @param dto Transfer request payload
     * @param idempotencyKey UUIDv4 from X-Idempotency-Key header
     * @param deviceId Device identifier from X-Device-ID header
     * @param userAgent Browser user agent (auto-captured)
     * @param clientIp Client IP address (from X-Forwarded-For or socket)
     *
     * @returns TransferResponse with transaction details and blockchain status
     *
     * Throws:
     * - BadRequestException (400): Invalid input or insufficient balance
     * - ConflictException (409): Duplicate request or lock timeout
     * - InternalServerErrorException (500): Database or blockchain failure
     */
    initiateTransfer(currentUser: any, dto: InitiateTransferDTO, idempotencyKey: string, deviceId: string, userAgent: string, clientIp?: string): Promise<TransferResponse>;
    /**
     * Get transaction details by ID
     *
     * @param currentUser Authenticated user
     * @param transactionId Transaction ID (UUID)
     * @returns Transaction record with status and blockchain anchor info
     *
     * Throws:
     * - NotFoundException (404): Transaction not found or not owned by user
     */
    getTransaction(currentUser: any, transactionId: string): Promise<any>;
    /**
     * Get transaction by RRN (UPI Reference Number)
     *
     * @param rrn UPI Reference Number (12-digit format: YYYY+DDD+hex)
     * @returns Transaction record
     */
    getTransactionByRrn(currentUser: any, rrn: string): Promise<any>;
    /**
     * Verify transaction on blockchain
     *
     * @param currentUser Authenticated user
     * @param dto Verification request with transaction hash
     * @returns Verification result and audit proof
     */
    verifyOnBlockchain(currentUser: any, dto: VerifyTransactionDTO): Promise<{
        verified: boolean;
        blockNumber: number;
        chainproof: any;
    }>;
    /**
     * Get paginated transaction history for current user
     *
     * @param currentUser Authenticated user
     * @param query Pagination and filter options
     * @returns Paginated transaction list
     */
    getTransactionHistory(currentUser: any, query: TransactionHistoryQueryDTO): Promise<{
        data: any;
        pagination: {
            page: number;
            limit: number;
            total: any;
            pages: number;
        };
    }>;
    private trackDeviceSession;
    private hashDeviceToken;
    private inferDeviceType;
}
