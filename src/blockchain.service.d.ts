import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';
export declare class BlockchainService {
    private prisma;
    private config;
    private readonly logger;
    private provider;
    private wallet;
    private contract;
    private contractAddress;
    constructor(prisma: PrismaService, config: ConfigService);
    /**
     * Initialize blockchain connection
     * Supports both public chains (Ethereum, Polygon) and private ledgers
     */
    private initializeBlockchain;
    /**
     * Anchor a transaction to the blockchain
     * Creates an immutable record with cryptographic hash
     */
    anchorTransaction(transactionId: string, txHash: string): Promise<{
        blockNumber: number;
        txId: string;
    }>;
    /**
     * Verify a transaction exists on-chain
     * Returns true if transaction hash is recorded in smart contract
     */
    verifyTransaction(txHash: string): Promise<boolean>;
    /**
     * Retrieve audit proof for transaction
     * Constructs merkle proof from blockchain events
     */
    getAuditProof(txHash: string): Promise<{
        verified: boolean;
        blockNumber: number | null;
        chainproof: string | null;
    }>;
    /**
     * Batch verify multiple transactions
     * Optimized for audit reconciliation
     */
    batchVerifyTransactions(txHashes: string[]): Promise<Map<string, boolean>>;
    /**
     * Get the last recorded anchor hash (chain tip)
     */
    getLastAnchorHash(): Promise<string | null>;
    /**
     * Get smart contract address
     */
    getContractAddress(): string;
    /**
     * Get wallet address (blockchain account)
     */
    getWalletAddress(): string;
    /**
     * Convert transaction hash string to bytes32 for smart contract
     * Ensures proper padding and formatting
     */
    private stringToBytes32;
    /**
     * Derive Ethereum address from transaction ID
     * Deterministic but non-reversible mapping for privacy
     */
    private deriveAddressFromId;
    /**
     * Construct merkle proof for transaction
     * Used for off-chain verification without querying blockchain
     */
    private constructMerkleProof;
}
