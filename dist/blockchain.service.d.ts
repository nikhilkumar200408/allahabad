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
    private initializeBlockchain;
    anchorTransaction(transactionId: string, txHash: string): Promise<{
        blockNumber: number;
        txId: string;
    }>;
    verifyTransaction(txHash: string): Promise<boolean>;
    getAuditProof(txHash: string): Promise<{
        verified: boolean;
        blockNumber: number | null;
        chainproof: string | null;
    }>;
    batchVerifyTransactions(txHashes: string[]): Promise<Map<string, boolean>>;
    getLastAnchorHash(): Promise<string | null>;
    getContractAddress(): string;
    getWalletAddress(): string;
    private stringToBytes32;
    private deriveAddressFromId;
    private constructMerkleProof;
}
